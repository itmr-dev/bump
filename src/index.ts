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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const git = simpleGit();

const pkgJson = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const packageVersion = pkgJson.version;

interface BumpRcConfig {
  updates: {
    check: boolean;
    autoUpdate: boolean;
  };
  branches: {
    allowed: string[];
  };
}

function getConfig(): BumpRcConfig {
  const defaultConfig: BumpRcConfig = {
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
    } else {
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    }
  } catch (error) {
    if (process.env.VERBOSE) {
      console.error(chalk.yellow('⚠'), chalk.white('Error reading config file:'), error);
    }
  }
  
  return defaultConfig;
}

async function checkForUpdates() {
  const config = getConfig();
  if (!config.updates.check) {
    if (process.env.VERBOSE) {
      console.log(chalk.grey('Update checks disabled via .bumprc'));
    }
    return;
  }

  const spinner = createSpinner('Checking for updates...').start();
  try {
    const { version: latestVersion } = await packageJsonFetch('@itmr.dev/bump');
    // Compare versions properly (x.y.z format)
    const isNewer = latestVersion.split('.').reduce((acc, curr, idx) => {
      if (acc !== 0) return acc;
      const latest = parseInt(curr, 10);
      const current = parseInt(packageVersion.split('.')[idx], 10);
      return latest - current;
    }, 0) > 0;

    if (isNewer) {
      if (config.updates.autoUpdate) {
        spinner.update({ text: 'Updating to latest version...' });
        try {
          await execa('npm', ['install', '-g', '@itmr.dev/bump']);
          spinner.stop();
          clearLines(1); // Remove spinner line
          console.log(chalk.green(`✔ Updated to version ${latestVersion}! Please run your command again.`));
          console.log(chalk.grey('Tip: You can disable automatic updates by setting "autoUpdate" to false in ~/.bumprc'));
          process.exit(0); // Exit and let user run their command again with updated version
        } catch (error) {
          spinner.stop();
          clearLines(1); // Remove spinner line
          console.log(chalk.red('⨯ Failed to update automatically.'));
          if (process.env.VERBOSE) console.error(error);
          process.exit(1);
        }
      } else {
        spinner.stop();
        clearLines(1);
        console.log(chalk.yellow('⚠'), chalk.white(`New version ${latestVersion} is available! Run 'npm install -g @itmr.dev/bump' to update.`));
      }
    } else {
      spinner.stop();
      clearLines(1);
      console.log(chalk.grey('You are using the latest version of bump!'));
    }
  } catch (error) {
    spinner.stop();
    clearLines(1); // Remove spinner line and any blank line
    if (process.env.VERBOSE) {
      console.error(chalk.yellow('⚠'), chalk.white('Unable to check for updates.'));
      console.error(error);
    }
  }
}

let interrupted = false;
let isExiting = false;
let cleanup: { type: 'stash' | 'version', data?: any }[] = [];

// Prevent multiple error messages
async function handleExit(code: number, error?: any) {
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
        const spinner = createSpinner('Restoring stashed changes').start();
        await git.stash(['pop']);
        spinner.success({ text: 'Stashed changes restored' });
      } else if (item.type === 'version') {
        const spinner = createSpinner('Reverting version changes').start();
        await git.reset(['--hard', 'HEAD~1']);
        if (item.data?.tag) {
          await git.tag(['--delete', item.data.tag]);
        }
        spinner.success({ text: 'Version changes reverted' });
      }
    } catch (error) {
      console.error(chalk.red(`Failed to cleanup ${item.type}`));
      if (process.env.VERBOSE) console.error(error);
    }
  }
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

function clearLines(n: number) {
  if (process.stdout.isTTY) {
    for (let i = 0; i < n; i++) {
      process.stdout.moveCursor(0, -1);
      process.stdout.clearLine(0);
    }
  }
}

interface BumpCommandConfig {
  bumpType: string;
  commitMessage: string;
  preId: string;
  verbose: boolean;
  stashChanges: boolean;
  forceBranch: boolean;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const config: BumpCommandConfig = {
      bumpType: args[0],
      commitMessage: args[1],
      preId: '',
      verbose: false,
      stashChanges: false,
      forceBranch: false
    };

    if (args.includes('-h') || args.includes('--help')) {
      displayHelp();
      handleExit(0);
      return;
    }

    if (args.includes('--verbose') || args.includes('-v')) {
      config.verbose = true;
      process.env.VERBOSE = 'true';
    }

    if (args.includes('--force-branch')) {
      config.forceBranch = true;
    }

    console.log(chalk.cyan('ℹ'), chalk.white('Welcome to bump!'));

    if (config.verbose) console.log(chalk.cyan('ℹ'), chalk.white('verbose logging enabled'));

    if (!args.includes('--help')) {
      await checkForUpdates(); // Check for updates (configurable via ~/.bumprc)
    }

    if (args.includes('--setup-workflows')) {
      const spinner = createSpinner('Setting up GitHub workflows', { color: 'gray' });
      await setupGithubWorkflows();
      spinner.success();
      console.log(chalk.green('✔ Workflows setup successfully!'));
      handleExit(0);
      return;
    }

    const workdirSpinner = createSpinner('checking working directory', { color: 'gray' });
    if (!existsSync(join(process.cwd(), 'package.json'))) {
      workdirSpinner.error();
      console.log(chalk.red('ⓧ No package.json found in the current directory.'));
      console.log(chalk.red('Please run bump from the root of your project.'));
      console.log(chalk.red('Aborting...'));
      handleExit(1);
      return;
    }

    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      workdirSpinner.error();
      console.log(chalk.red('ⓧ No git repository found in the current directory.'));
      console.log(chalk.red('Please run bump from the root of your project.'));
      console.log(chalk.red('Aborting...'));
      handleExit(1);
      return;
    }
    workdirSpinner.success();

    if (!config.bumpType) {
      console.log(chalk.red('\nⓧ No version type provided.'));
      config.bumpType = await promptBumpType();
    } else {
      if (!validBumpTypes.includes(config.bumpType)) {
        console.log(chalk.red('\nⓧ Invalid version type provided.'));
        config.bumpType = await promptBumpType();
      }
    }

    if (interrupted) return;

    if (config.bumpType.includes('pre')) {
      // Check if there's already a preid in the latest tag
      let existingPreId = '';
      try {
        const latestTagSpinner = createSpinner('checking latest tag', { color: 'gray' });
        latestTagSpinner.start();
        const tags = await git.tags();
        if (tags.all.length > 0) {
          // Get the latest tag from the list
          const latestTag = tags.all[tags.all.length - 1];
          // Extract preid from tag (format: v1.0.0-beta.0 -> beta)
          const match = latestTag.match(/\d+\.\d+\.\d+-([a-zA-Z]+)(?:\.\d+)?$/);
          if (match && match[1]) {
            existingPreId = match[1];
            if (config.verbose) console.log(chalk.cyan('ℹ'), chalk.white(`Found existing preid: ${existingPreId}`));
          }
        }
        latestTagSpinner.success();
      } catch (error) {
        if (config.verbose) console.error(chalk.yellow('⚠'), chalk.white('Unable to check latest tag for preid.'), error);
      }

      if (interrupted) return;

      const preIdWanted = await promptIfPreId();
      if (preIdWanted && !interrupted) {
        config.preId = await promptPreId(existingPreId);
      }
    }

    if (interrupted) return;

    if (!config.commitMessage) {
      console.log(chalk.red('\nⓧ No commit message provided.'));
      config.commitMessage = await promptCommitMessage();
    }

    if (interrupted) return;

    // Check current branch before proceeding
    const branchSpinner = createSpinner('checking current branch', { color: 'gray' });
    branchSpinner.start();

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
    } catch (error) {
      branchSpinner.error();
      console.log(chalk.red('ⓧ Failed to check current branch.'));
      if (config.verbose) console.error(error);
      await handleExit(1, error);
      return;
    }

    if (interrupted) return;

    const gitStatusSpinner = createSpinner('checking git status', { color: 'gray' });
    gitStatusSpinner.start();

    try {
      const gitStatus = await git.status();
      gitStatusSpinner.success();
      if (gitStatus.files.length > 0) {
        console.log(chalk.yellow('\n⚠ You have uncommitted changes'));
        const commit = await promptCommitChanges()
        if (!commit && !interrupted) {
          config.stashChanges = await promptContinueEvenThoChanges()
          if (!config.stashChanges) {
            console.log(chalk.red('\nⓧ Aborting...'));
            handleExit(1);
            return;
          }
        }
      }
    } catch (error) {
      gitStatusSpinner.error();
      await handleExit(1, error);
      return;
    }

    if (interrupted) return;

    const versionSpinner = createSpinner('bumping version', { color: 'gray' });
    versionSpinner.start();

    let stashingSpinner;
    if (config.stashChanges) {
      try {
        stashingSpinner = createSpinner('stashing your changes', { color: 'gray' });
        stashingSpinner.start();
        if (!interrupted) {
          await git.stash(['push', '-m', `(bump) automated stash from ${new Date().toISOString()}`]);
          cleanup.push({ type: 'stash' });
          stashingSpinner.success();
        } else {
          stashingSpinner.warn({ text: 'Stashing cancelled' });
          return;
        }
      } catch (error) {
        stashingSpinner?.error();
        versionSpinner.error();
        await handleExit(1, error);
        return;
      }
    }

    try {
      if (!interrupted) {
        await git.add('.');
        const npmArgs = ['version', config.bumpType, '-m', `(%s) ${config.commitMessage}\n\ncommited using @itmr.dev/bump`, '-f'];
        if (config.preId) {
          npmArgs.push(`--preid=${config.preId}`);
        }
        // Get current version before bump
        const { stdout: newTag } = await execa('npm', ['version', '--no-git-tag-version', '--no-commit-hooks', config.bumpType]);
        // Reset the version change
        await execa('git', ['checkout', 'package.json']);
        // Now do the actual bump
        await execa('npm', npmArgs);
        cleanup.push({ type: 'version', data: { tag: newTag.trim() } });
        versionSpinner.success();
      } else {
        versionSpinner.warn({ text: 'Version bump cancelled' });
        await handleExit(1);
        return;
      }
    } catch (error) {
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
      } catch (error) {
        stashingSpinner?.error();
        versionSpinner.error();
        await handleExit(1, error);
        return;
      }
    }

    if (interrupted) return;

    let pushSpinner;
    try {
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      let remote = await git.remote(['get-url', 'origin']);
      if (!remote) {
        console.log(chalk.yellow('\n⚠ Unable to determine remote. Skipping push.'));
      } else {
        remote = remote.trim();
        const push = await promptPushChanges();
        if (push && !interrupted) {
          pushSpinner = createSpinner('pushing changes', { color: 'gray' });
          pushSpinner.start();
          await git.push(remote, currentBranch);
          await git.pushTags(remote);
          await git.fetch();
          pushSpinner.success();
        }
      }
    } catch (error) {
      pushSpinner?.error();
      await handleExit(1, error);
      return;
    }

    if (!interrupted) {
      cleanup = []; // Clear cleanup as everything succeeded
      console.log(chalk.green('\n✔ Version bumped successfully!'));
    }

  } catch (error) {
    await handleExit(1, error);
  }
}

async function promptBumpType(): Promise<string> {
  if (interrupted) return '';
  
  const mainChoices = ['patch', 'minor', 'major', new inquirer.Separator(), 'other'];
  
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What type of version bump would you like to make?',
      choices: mainChoices,
    },
  ]);

  if (interrupted) return '';

  if (choice === 'other') {
    // Clear previous prompt (just the question line)
    clearLines(1);
    
    const { otherChoice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'otherChoice',
        message: 'Select pre-release type:',
        choices: [...validBumpTypes.filter(type => type.startsWith('pre')), new inquirer.Separator(), 'back'],
      },
    ]);

    if (interrupted) return '';

    if (otherChoice === 'back') {
      // Clear pre-release prompt before going back
      clearLines(1);
      return promptBumpType();
    }

    return interrupted ? '' : otherChoice;
  }

  return interrupted ? '' : choice;
}

async function promptIfPreId(): Promise<boolean> {
  if (interrupted) return false;
  const { modifier } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'modifier',
      message: 'Would you like to add a modifier to the version?',
    },
  ]);
  return interrupted ? false : modifier;
}

async function promptPreId(defaultPreId = ''): Promise<string> {
  if (interrupted) return '';
  const { modifier } = await inquirer.prompt([
    {
      type: 'input',
      name: 'modifier',
      message: 'What modifier would you like to add?',
      default: defaultPreId,
    },
  ]);
  return interrupted ? '' : modifier;
}

async function promptCommitMessage(): Promise<string> {
  if (interrupted) return '';
  const { commitMessage } = await inquirer.prompt([
    {
      type: 'input',
      name: 'commitMessage',
      message: 'What commit message would you like to use?',
      default: 'bump version',
    },
  ]);
  return interrupted ? '' : commitMessage;
}

async function promptCommitChanges(): Promise<boolean> {
  if (interrupted) return false;
  const { commitChanges } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'commitChanges',
      message: 'Would you like to commit these changes with the bump?',
    },
  ]);
  return interrupted ? false : commitChanges;
}

async function promptContinueEvenThoChanges(): Promise<boolean> {
  if (interrupted) return false;
  const { stillContinue } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'stillContinue',
      message: 'Would you like proceed with the bump, without including your changes?',
    },
  ]);
  return interrupted ? false : stillContinue;
}

async function promptPushChanges(): Promise<boolean> {
  if (interrupted) return false;
  const { pushChanges } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'pushChanges',
      message: 'Would you like to push these changes to the remote?',
    },
  ]);
  return interrupted ? false : pushChanges;
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
  console.log('\nArguments:');
  console.log('  <version-type>         Type of version bump to apply (see Version types above)');
  console.log('  [commitMessage]        Optional commit message (default: "bump version")');
  console.log('\nBranch Protection:');
  console.log('  By default, version bumping is only allowed on main or master branches.');
  console.log('  Use --force-branch to override this safety check and bump on any branch.');
  console.log('  Configure allowed branches by editing the branches.allowed array in ~/.bumprc');
  console.log('\nConfiguration:');
  console.log('  bump uses the .bumprc file in your home directory to store configuration settings.');
  console.log('  You can disable update checks, enable auto-updates, and configure allowed branches.');
  console.log('  To edit the file open it in your favorite text editor (e.g.',chalk.italic('vim ~/.bumprc'),')');
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
