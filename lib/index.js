#!/usr/bin/env node
import chalk from 'chalk';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { createSpinner } from 'nanospinner';
import { simpleGit } from 'simple-git';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import packageJsonFetch from 'package-json';
import semver from 'semver';
import { parseArgs } from './args.js';
import { detect, readVersion, writeVersion } from './adapters/index.js';
import { parseVersion, nextVersion, highestTag, isNewer } from './version.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const git = simpleGit();
const pkgJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const packageVersion = pkgJson.version;
const CHANGELOG_URL = 'https://github.com/itmr-dev/bump/blob/main/CHANGELOG.md';
function getConfig() {
    const defaultConfig = {
        lastVersion: packageVersion,
        updates: {
            check: true,
            autoUpdate: true
        },
        branches: {
            allowed: ['main', 'master']
        }
    };
    const configPath = join(process.env.HOME || '', '.bumprc');
    try {
        if (existsSync(configPath)) {
            const config = JSON.parse(readFileSync(configPath, 'utf8'));
            return {
                ...defaultConfig,
                ...config,
                branches: {
                    ...defaultConfig.branches,
                    ...config.branches
                }
            };
        }
        else {
            writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        }
    }
    catch (error) {
        if (process.env.VERBOSE) {
            console.error(chalk.yellow('⚠'), chalk.white('Error reading config file:'), error);
        }
    }
    return defaultConfig;
}
// shown once after a major update; a .bumprc without lastVersion was written by v1
function showMajorUpdateNotice() {
    const configPath = join(process.env.HOME || '', '.bumprc');
    try {
        if (!existsSync(configPath))
            return; // first run ever, getConfig records lastVersion
        const rc = JSON.parse(readFileSync(configPath, 'utf8'));
        if (rc.lastVersion === packageVersion)
            return;
        if (semver.major(packageVersion) > semver.major(rc.lastVersion ?? '1.0.0')) {
            console.log(chalk.magenta('★'), chalk.white(`bump was updated to v${packageVersion}, a lot has changed.`));
            console.log(chalk.magenta(' '), chalk.white('What is new and what to watch out for:'), chalk.cyan(CHANGELOG_URL));
        }
        rc.lastVersion = packageVersion;
        writeFileSync(configPath, JSON.stringify(rc, null, 2), 'utf8');
    }
    catch (error) {
        if (process.env.VERBOSE)
            console.error(chalk.yellow('⚠'), chalk.white('Unable to check last used version.'), error);
    }
}
async function checkForUpdates(nonInteractive) {
    const config = getConfig();
    if (nonInteractive) {
        // agents and CI want the bump they asked for, not a self-update that exits 0
        if (process.env.VERBOSE)
            console.log(chalk.grey('Update check skipped in non-interactive mode'));
        return;
    }
    if (!config.updates.check) {
        if (process.env.VERBOSE) {
            console.log(chalk.grey('Update checks disabled via .bumprc'));
        }
        return;
    }
    // nanospinner >= 1.2: stop() without options removes the spinner line, nothing to clear by hand
    const spinner = startSpinner(createSpinner('Checking for updates...'));
    try {
        const { version: latestVersion } = await packageJsonFetch('@itmr.dev/bump');
        if (isNewer(latestVersion, packageVersion)) {
            if (config.updates.autoUpdate) {
                spinner.update({ text: 'Updating to latest version...' });
                try {
                    await execa('npm', ['install', '-g', '@itmr.dev/bump']);
                    spinner.stop();
                    console.log(chalk.green(`✔ Updated to version ${latestVersion}! Please run your command again.`));
                    console.log(chalk.grey('Tip: You can disable automatic updates by setting "autoUpdate" to false in ~/.bumprc'));
                    process.exit(0); // Exit and let user run their command again with updated version
                }
                catch (error) {
                    spinner.stop();
                    console.log(chalk.red('⨯ Failed to update automatically.'));
                    if (process.env.VERBOSE)
                        console.error(error);
                    process.exit(1);
                }
            }
            else {
                spinner.stop();
                console.log(chalk.yellow('⚠'), chalk.white(`New version ${latestVersion} is available! Run 'npm install -g @itmr.dev/bump' to update.`));
            }
        }
        else {
            spinner.stop();
            console.log(chalk.grey('You are using the latest version of bump!'));
        }
    }
    catch (error) {
        spinner.stop();
        if (process.env.VERBOSE) {
            console.error(chalk.yellow('⚠'), chalk.white('Unable to check for updates.'));
            console.error(error);
        }
    }
}
let interrupted = false;
let nonInteractive = false;
let isExiting = false;
let cleanup = [];
async function runNpmScript(name) {
    const scripts = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).scripts ?? {};
    if (!scripts[name])
        return;
    const { stdout } = await execa('npm', ['run', name]);
    if (process.env.VERBOSE)
        console.log(stdout);
}
// Prevent multiple error messages
async function handleExit(code, error) {
    if (!isExiting) {
        isExiting = true;
        if (cleanup.length > 0) {
            if (error) {
                console.error(chalk.red('\nⓧ An error occurred:'));
                console.error(error);
            }
            console.log(chalk.yellow('\nReverting changes...'));
            await performCleanup();
            console.log(chalk.green('✔ Changes reverted'));
        }
        process.exit(code);
    }
}
async function performCleanup() {
    for (const item of cleanup.reverse()) {
        try {
            if (item.type === 'stash') {
                const spinner = startSpinner(createSpinner('Restoring stashed changes'));
                await git.stash(['pop']);
                spinner.success({ text: 'Stashed changes restored' });
            }
            else if (item.type === 'version') {
                const spinner = startSpinner(createSpinner('Reverting version changes'));
                // never --hard: a mixed reset to where bump started drops the bump commit (and any
                // commit an npm script made) but keeps every file on disk, so no work is lost
                if (item.data?.committed && item.data.base) {
                    const dropped = (await git.revparse(['HEAD'])).trim();
                    await git.reset(['-q', item.data.base]);
                    console.log(chalk.grey(`\n  dropped commit ${dropped.slice(0, 7)}, recover it with: git reset --hard ${dropped}`));
                }
                else {
                    await git.reset(['-q']);
                }
                // put back what was on disk before the bump, not HEAD: may include uncommitted edits or untracked files
                for (const { path, text } of item.data?.originals ?? [])
                    writeFileSync(path, text);
                if (item.data?.tag) {
                    await git.tag(['--delete', item.data.tag]);
                }
                spinner.success({ text: 'Version changes reverted' });
            }
        }
        catch (error) {
            console.error(chalk.red(`Failed to cleanup ${item.type}`));
            if (process.env.VERBOSE)
                console.error(error);
        }
    }
}
// nanospinner >= 1.2 calls process.exit on Ctrl+C while spinning, which would cut bump's rollback short.
// Drop the handlers it adds on start so the SIGINT handler below stays in charge.
function startSpinner(spinner) {
    const before = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
    spinner.start();
    for (const signal of ['SIGINT', 'SIGTERM']) {
        for (const listener of process.listeners(signal)) {
            if (!before[signal].includes(listener))
                process.off(signal, listener);
        }
    }
    return spinner;
}
// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
    interrupted = true;
    console.log(chalk.yellow('\n\nInterrupted by user'));
    await handleExit(0);
});
// Handle unhandled errors and promise rejections
process.on('uncaughtException', async (error) => {
    if (!interrupted && !isExiting) {
        await handleExit(1, error);
    }
});
process.on('unhandledRejection', async (error) => {
    if (!interrupted && !isExiting) {
        await handleExit(1, error);
    }
});
const validBumpTypes = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];
function clearLines(n) {
    if (process.stdout.isTTY) {
        for (let i = 0; i < n; i++) {
            process.stdout.moveCursor(0, -1);
            process.stdout.clearLine(0);
        }
    }
}
async function main() {
    try {
        const config = parseArgs(process.argv.slice(2), Boolean(process.stdin.isTTY) && !process.env.CI);
        nonInteractive = config.nonInteractive;
        if (config.help) {
            displayHelp();
            handleExit(0);
            return;
        }
        if (config.unknown.length > 0) {
            console.log(chalk.red(`ⓧ Unknown option(s): ${config.unknown.join(', ')}`));
            console.log(chalk.cyan('Run bump --help to see available options.'));
            handleExit(1);
            return;
        }
        if (config.verbose)
            process.env.VERBOSE = 'true';
        console.log(chalk.cyan('ℹ'), chalk.white('Welcome to bump!'));
        if (config.verbose)
            console.log(chalk.cyan('ℹ'), chalk.white('verbose logging enabled'));
        if (nonInteractive)
            console.log(chalk.cyan('ℹ'), chalk.white('non-interactive mode: prompts are skipped'));
        showMajorUpdateNotice();
        await checkForUpdates(nonInteractive); // Check for updates (configurable via ~/.bumprc)
        if (config.setupWorkflows) {
            const spinner = createSpinner('Setting up GitHub workflows', { color: 'gray' });
            await setupGithubWorkflows();
            spinner.success();
            console.log(chalk.green('✔ Workflows setup successfully!'));
            handleExit(0);
            return;
        }
        const workdirSpinner = createSpinner('checking working directory', { color: 'gray' });
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            workdirSpinner.error();
            console.log(chalk.red('ⓧ No git repository found in the current directory.'));
            console.log(chalk.red('Please run bump from the root of your project.'));
            console.log(chalk.red('Aborting...'));
            handleExit(1);
            return;
        }
        let versionFiles;
        try {
            versionFiles = detect(process.cwd());
        }
        catch (error) {
            workdirSpinner.error();
            console.log(chalk.red(`ⓧ ${error.message}`));
            console.log(chalk.red('Aborting...'));
            handleExit(1);
            return;
        }
        workdirSpinner.success();
        let currentVersion;
        const checkedFiles = versionFiles.filter(f => !f.adapter.follows);
        if (checkedFiles.length > 0) {
            console.log(chalk.cyan('ℹ'), chalk.white(`versions found in: ${versionFiles.map(f => f.adapter.file).join(', ')}`));
            const invalid = checkedFiles.find(f => !parseVersion(f.current));
            if (invalid) {
                console.log(chalk.red(`ⓧ ${invalid.adapter.file} has version '${invalid.current}', which is not a valid version.`));
                console.log(chalk.red('Aborting...'));
                handleExit(1);
                return;
            }
            if (new Set(checkedFiles.map(f => parseVersion(f.current))).size > 1) {
                console.log(chalk.red('ⓧ Version files disagree on the current version:'));
                for (const f of checkedFiles)
                    console.log(chalk.red(`  ${f.adapter.file} → ${f.current}`));
                console.log(chalk.red('Aborting...'));
                handleExit(1);
                return;
            }
            currentVersion = parseVersion(checkedFiles[0].current);
        }
        else {
            currentVersion = highestTag((await git.tags()).all) ?? '0.0.0';
            console.log(chalk.cyan('ℹ'), chalk.white(`no version files found, using git tags only (current: v${currentVersion})`));
        }
        if (!validBumpTypes.includes(config.bumpType)) {
            console.log(chalk.red(config.bumpType ? '\nⓧ Invalid version type provided.' : '\nⓧ No version type provided.'));
            if (nonInteractive) {
                console.log(chalk.red(`Expected one of: ${validBumpTypes.join(', ')}`));
                console.log(chalk.red('Aborting...'));
                handleExit(1);
                return;
            }
            config.bumpType = await promptBumpType();
        }
        if (interrupted)
            return;
        if (config.bumpType.includes('pre')) {
            // Check if there's already a preid in the latest tag
            let existingPreId = '';
            try {
                const latestTagSpinner = createSpinner('checking latest tag', { color: 'gray' });
                startSpinner(latestTagSpinner);
                const tags = await git.tags();
                if (tags.all.length > 0) {
                    // Get the latest tag from the list
                    const latestTag = tags.all[tags.all.length - 1];
                    // Extract preid from tag (format: v1.0.0-beta.0 -> beta)
                    const match = latestTag.match(/\d+\.\d+\.\d+-([a-zA-Z]+)(?:\.\d+)?$/);
                    if (match && match[1]) {
                        existingPreId = match[1];
                        if (config.verbose)
                            console.log(chalk.cyan('ℹ'), chalk.white(`Found existing preid: ${existingPreId}`));
                    }
                }
                latestTagSpinner.success();
            }
            catch (error) {
                if (config.verbose)
                    console.error(chalk.yellow('⚠'), chalk.white('Unable to check latest tag for preid.'), error);
            }
            if (interrupted)
                return;
            if (!config.preId && await promptIfPreId() && !interrupted) {
                config.preId = await promptPreId(existingPreId);
            }
        }
        if (interrupted)
            return;
        if (!config.commitMessage) {
            if (!nonInteractive)
                console.log(chalk.red('\nⓧ No commit message provided.'));
            config.commitMessage = await promptCommitMessage();
        }
        if (interrupted)
            return;
        // Check current branch before proceeding
        const branchSpinner = createSpinner('checking current branch', { color: 'gray' });
        startSpinner(branchSpinner);
        try {
            const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
            const bumpConfig = getConfig();
            const allowedBranches = bumpConfig.branches.allowed;
            const isAllowedBranch = allowedBranches.includes(currentBranch.trim());
            branchSpinner.success();
            if (!isAllowedBranch && !config.forceBranch) {
                console.log(chalk.red(`\nⓧ Cannot bump version on branch '${currentBranch.trim()}'.`));
                console.log(chalk.red(`Version bumping is only allowed on: ${allowedBranches.join(', ')}`));
                console.log(chalk.cyan('Please switch to an allowed branch before bumping'));
                console.log(chalk.cyan(`(${allowedBranches.join(', ')})`));
                console.log(chalk.cyan('or use --force-branch to override this check:'));
                console.log(chalk.cyan(`  bump --force-branch ${config.bumpType} "${config.commitMessage}"`));
                console.log(chalk.cyan('Or edit ~/.bumprc to configure allowed branches.'));
                console.log(chalk.red('Aborting...'));
                handleExit(1);
                return;
            }
            if (!isAllowedBranch && config.forceBranch) {
                console.log(chalk.yellow(`⚠ Branch check overridden. Bumping version on '${currentBranch.trim()}' branch.`));
            }
            if (config.verbose) {
                console.log(chalk.cyan('ℹ'), chalk.white(`Current branch: ${currentBranch.trim()}`));
                console.log(chalk.cyan('ℹ'), chalk.white(`Allowed branches: ${allowedBranches.join(', ')}`));
            }
        }
        catch (error) {
            branchSpinner.error();
            console.log(chalk.red('ⓧ Failed to check current branch.'));
            if (config.verbose)
                console.error(error);
            await handleExit(1, error);
            return;
        }
        if (interrupted)
            return;
        const gitStatusSpinner = createSpinner('checking git status', { color: 'gray' });
        startSpinner(gitStatusSpinner);
        try {
            const gitStatus = await git.status();
            gitStatusSpinner.success();
            if (gitStatus.files.length > 0) {
                console.log(chalk.yellow('\n⚠ You have uncommitted changes'));
                const commit = await promptCommitChanges();
                if (!commit && !interrupted) {
                    config.stashChanges = await promptContinueEvenThoChanges();
                    if (!config.stashChanges) {
                        console.log(chalk.red('\nⓧ Aborting...'));
                        handleExit(1);
                        return;
                    }
                }
            }
        }
        catch (error) {
            gitStatusSpinner.error();
            await handleExit(1, error);
            return;
        }
        if (interrupted)
            return;
        let newVersion;
        try {
            newVersion = nextVersion(currentVersion, config.bumpType, config.preId);
        }
        catch (error) {
            console.log(chalk.red(`ⓧ ${error.message}`));
            handleExit(1);
            return;
        }
        const versionSpinner = createSpinner('bumping version', { color: 'gray' });
        startSpinner(versionSpinner);
        let stashingSpinner;
        if (config.stashChanges) {
            try {
                stashingSpinner = createSpinner('stashing your changes', { color: 'gray' });
                startSpinner(stashingSpinner);
                if (!interrupted) {
                    await git.stash(['push', '-m', `(bump) automated stash from ${new Date().toISOString()}`]);
                    cleanup.push({ type: 'stash' });
                    stashingSpinner.success();
                }
                else {
                    stashingSpinner.warn({ text: 'Stashing cancelled' });
                    return;
                }
            }
            catch (error) {
                stashingSpinner?.error();
                versionSpinner.error();
                await handleExit(1, error);
                return;
            }
        }
        try {
            if (!interrupted) {
                const hasNpm = versionFiles.some(f => f.adapter.name === 'npm');
                const message = `(${newVersion}) ${config.commitMessage}\n\ncommited using @itmr.dev/bump`;
                const versionCleanup = { type: 'version', data: { base: (await git.revparse(['HEAD']).catch(() => '')).trim(), originals: [], committed: false, tag: '' } };
                cleanup.push(versionCleanup);
                if (hasNpm)
                    await runNpmScript('preversion');
                for (const f of versionFiles) {
                    const original = readFileSync(f.path, 'utf8');
                    versionCleanup.data.originals.push({ path: f.path, text: original });
                    writeFileSync(f.path, writeVersion(f.adapter, original, newVersion));
                    const written = readVersion(f.adapter, readFileSync(f.path, 'utf8'));
                    if (parseVersion(written ?? '') !== newVersion)
                        throw new Error(`${f.adapter.file}: expected ${newVersion} after writing, found ${written}`);
                }
                if (hasNpm)
                    await runNpmScript('version');
                await git.add('.');
                // tag-only mode with a clean tree: just tag, no empty commit
                if ((await git.status()).staged.length > 0) {
                    // simple-git resolves when a silent pre-commit hook rejects the commit
                    if (!(await git.commit(message)).commit)
                        throw new Error('git commit failed (rejected by a hook?)');
                    versionCleanup.data.committed = true;
                }
                await git.tag(['-a', `v${newVersion}`, '-m', message]);
                versionCleanup.data.tag = `v${newVersion}`;
                if (hasNpm)
                    await runNpmScript('postversion');
                versionSpinner.success({ text: `bumped ${currentVersion} → ${newVersion}` });
            }
            else {
                versionSpinner.warn({ text: 'Version bump cancelled' });
                await handleExit(1);
                return;
            }
        }
        catch (error) {
            versionSpinner.error();
            await handleExit(1, error);
            return;
        }
        if (config.stashChanges) {
            try {
                stashingSpinner?.update({ text: 'restoring stashed changes' });
                await git.stash(['pop']);
                cleanup = cleanup.filter(item => item.type !== 'stash');
                stashingSpinner?.success();
            }
            catch (error) {
                stashingSpinner?.error();
                versionSpinner.error();
                await handleExit(1, error);
                return;
            }
        }
        if (interrupted)
            return;
        let pushSpinner;
        try {
            const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
            // simple-git throws when the remote is missing, it does not return empty
            let remote = await git.remote(['get-url', 'origin']).catch(() => '');
            if (!remote) {
                console.log(chalk.yellow('\n⚠ Unable to determine remote. Skipping push.'));
            }
            else {
                remote = remote.trim();
                const push = config.push ?? await promptPushChanges();
                if (!push && nonInteractive) {
                    console.log(chalk.yellow('⚠ Not pushing. Pass --push to push the commit and tag.'));
                }
                if (push && !interrupted) {
                    pushSpinner = createSpinner('pushing changes', { color: 'gray' });
                    startSpinner(pushSpinner);
                    await git.push(remote, currentBranch);
                    await git.pushTags(remote);
                    await git.fetch();
                    pushSpinner.success();
                }
            }
        }
        catch (error) {
            pushSpinner?.error();
            await handleExit(1, error);
            return;
        }
        if (!interrupted) {
            cleanup = []; // Clear cleanup as everything succeeded
            console.log(chalk.green('\n✔ Version bumped successfully!'));
        }
    }
    catch (error) {
        await handleExit(1, error);
    }
}
async function promptBumpType() {
    if (interrupted)
        return '';
    const mainChoices = ['patch', 'minor', 'major', new inquirer.Separator(), 'other'];
    const { choice } = await inquirer.prompt([
        {
            type: 'select',
            name: 'choice',
            message: 'What type of version bump would you like to make?',
            choices: mainChoices,
        },
    ]);
    if (interrupted)
        return '';
    if (choice === 'other') {
        // Clear previous prompt (just the question line)
        clearLines(1);
        const { otherChoice } = await inquirer.prompt([
            {
                type: 'select',
                name: 'otherChoice',
                message: 'Select pre-release type:',
                choices: [...validBumpTypes.filter(type => type.startsWith('pre')), new inquirer.Separator(), 'back'],
            },
        ]);
        if (interrupted)
            return '';
        if (otherChoice === 'back') {
            // Clear pre-release prompt before going back
            clearLines(1);
            return promptBumpType();
        }
        return interrupted ? '' : otherChoice;
    }
    return interrupted ? '' : choice;
}
async function ask(question, fallback) {
    if (interrupted || nonInteractive)
        return fallback;
    const answers = await inquirer.prompt([question]);
    return interrupted ? fallback : answers[question.name];
}
async function promptIfPreId() {
    return ask({
        type: 'confirm',
        name: 'modifier',
        message: 'Would you like to add a modifier to the version?',
    }, false);
}
async function promptPreId(defaultPreId = '') {
    return ask({
        type: 'input',
        name: 'modifier',
        message: 'What modifier would you like to add?',
        default: defaultPreId,
    }, defaultPreId);
}
async function promptCommitMessage() {
    return ask({
        type: 'input',
        name: 'commitMessage',
        message: 'What commit message would you like to use?',
        default: 'bump version',
    }, 'bump version');
}
async function promptCommitChanges() {
    // non-interactive: include the uncommitted changes in the bump commit
    return ask({
        type: 'confirm',
        name: 'commitChanges',
        message: 'Would you like to commit these changes with the bump?',
    }, true);
}
async function promptContinueEvenThoChanges() {
    return ask({
        type: 'confirm',
        name: 'stillContinue',
        message: 'Would you like proceed with the bump, without including your changes?',
    }, false);
}
async function promptPushChanges() {
    // non-interactive: pushing is opt-in via --push
    return ask({
        type: 'confirm',
        name: 'pushChanges',
        message: 'Would you like to push these changes to the remote?',
    }, false);
}
function displayHelp() {
    console.log(chalk.green('Usage: bump [options] <version-type> [commitMessage]'));
    console.log('\nVersion types:');
    console.log('  patch|minor|major       Standard version increments');
    console.log('  premajor|preminor      Pre-release version increments');
    console.log('  prepatch|prerelease    Additional pre-release options\n');
    console.log('\nOptions:');
    console.log('  -h, --help               Display this help message.\n');
    console.log('      --setup-workflows    Setup automatic Docker image build workflows for GitHub.');
    console.log('                           This is perfect if you also use itmr-dev/blaze for your ci/cd\n');
    console.log('  -v, --verbose            Enable verbose logging');
    console.log('      --force-branch       Allow bumping on branches other than main/master');
    console.log('  -y, --yes                Never prompt; use defaults (implied when not a TTY or when CI is set)');
    console.log('      --preid <id>         Pre-release identifier, e.g. --preid beta');
    console.log('      --push, --no-push    Push (or do not push) commit and tags without asking');
    console.log('\nArguments:');
    console.log('  <version-type>         Type of version bump to apply (see Version types above)');
    console.log('  [commitMessage]        Optional commit message (default: "bump version")');
    console.log('\nSupported projects:');
    console.log('  package.json (+ package-lock.json), app.json (Expo), library.json (PlatformIO),');
    console.log('  library.properties (Arduino), Cargo.toml, pyproject.toml, pubspec.yaml, Chart.yaml.');
    console.log('  Every file found is bumped. With none, bump uses git tags only.');
    console.log('  Other files: add a .bump.json to the repo root, e.g.');
    console.log(chalk.gray('  { "files": [{ "path": "platformio.ini", "pattern": "custom_version\\\\s*=\\\\s*(\\\\S+)" }] }'));
    console.log('\nNon-interactive (CI / AI agents):');
    console.log('  bump never prompts when stdin is not a TTY, when CI is set, or with --yes.');
    console.log('  In that mode the version type is required, the commit message defaults to');
    console.log('  "bump version", uncommitted changes are included in the bump commit, and');
    console.log('  nothing is pushed unless --push is given. Exit code is 0 on success, 1 on failure.');
    console.log('  Example: bump patch "release" --preid beta --push --force-branch');
    console.log('\nBranch Protection:');
    console.log('  By default, version bumping is only allowed on main or master branches.');
    console.log('  Use --force-branch to override this safety check and bump on any branch.');
    console.log('  Configure allowed branches by editing the branches.allowed array in ~/.bumprc');
    console.log('\nConfiguration:');
    console.log('  bump uses the .bumprc file in your home directory to store configuration settings.');
    console.log('  You can disable update checks, enable auto-updates, and configure allowed branches.');
    console.log('  To edit the file open it in your favorite text editor (e.g.', chalk.italic('vim ~/.bumprc'), ')');
    console.log('\n  Example .bumprc:');
    console.log(chalk.gray('  {'));
    console.log(chalk.gray('    "updates": { "check": true, "autoUpdate": false },'));
    console.log(chalk.gray('    "branches": { "allowed": ["main", "master", "develop"] }'));
    console.log(chalk.gray('  }'));
    console.log(chalk.dim.italic.gray('  But how do I exit vim... ¯\\_(ツ)_/¯'));
}
async function setupGithubWorkflows() {
    const workflowsDir = join(process.cwd(), '.github', 'workflows');
    if (!await existsSync(workflowsDir)) {
        await mkdirSync(workflowsDir, { recursive: true });
    }
    const workflows = [
        'docker-ci-dev.yml',
        'docker-ci-prod.yml',
    ];
    for await (const workflow of workflows) {
        const source = join(__dirname, '..', 'templates', workflow);
        const dest = join(workflowsDir, workflow);
        await copyFileSync(source, dest);
    }
}
// Start the script
main().catch(async (error) => {
    if (!interrupted && !isExiting) {
        await handleExit(1, error);
    }
});
//# sourceMappingURL=index.js.map