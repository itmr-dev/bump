#!/usr/bin/env node
import chalk from 'chalk';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { createSpinner } from 'nanospinner';
import { simpleGit } from 'simple-git';
import { existsSync } from 'fs';
import { join } from 'path';
const git = simpleGit();
const validBumpTypes = ['major', 'minor', 'patch'];
const args = process.argv.slice(2);
let [bumpType, commitMessage] = args;
if (args.includes('-h') || args.includes('--help')) {
    displayHelp();
    process.exit(0);
}
console.log(chalk.cyan('ℹ'), chalk.white('Welcome to bump!'));
const workdirSpinner = createSpinner('checking working directory', { color: 'gray' });
if (!existsSync(join(process.cwd(), 'package.json'))) {
    workdirSpinner.error();
    console.log(chalk.red('ⓧ No package.json found in the current directory.'));
    console.log(chalk.red('Please run bump from the root of your project.'));
    console.log(chalk.red('Aborting...'));
    process.exit(1);
}
const isRepo = await git.checkIsRepo();
if (!isRepo) {
    workdirSpinner.error();
    console.log(chalk.red('ⓧ No git repository found in the current directory.'));
    console.log(chalk.red('Please run bump from the root of your project.'));
    console.log(chalk.red('Aborting...'));
    process.exit(1);
}
workdirSpinner.success();
if (!bumpType) {
    console.log(chalk.red('\nⓧ No version type provided.'));
    await promptBumpType();
}
else {
    if (!validBumpTypes.includes(bumpType)) {
        console.log(chalk.red('\nⓧ Invalid version type provided.'));
        await promptBumpType();
    }
}
if (!commitMessage) {
    console.log(chalk.red('\nⓧ No commit message provided.'));
    await promptCommitMessage();
}
const gitStatusSpinner = createSpinner('checking git status', { color: 'gray' });
gitStatusSpinner.start();
try {
    const gitStatus = await git.status();
    gitStatusSpinner.success();
    if (gitStatus.files.length > 0) {
        console.log(chalk.yellow('\n⚠ You have uncommitted changes'));
        const commit = await promptCommitChanges();
        if (!commit) {
            console.log(chalk.red('\nⓧ Aborting...'));
            process.exit(1);
        }
    }
}
catch (error) {
    gitStatusSpinner.error();
    console.error(chalk.red('\nⓧ Unable to check git status.'));
    process.exit(1);
}
const versionSpinner = createSpinner('bumping version', { color: 'gray' });
versionSpinner.start();
try {
    await git.add('.');
    await execa('npm', ['version', bumpType, '-m', commitMessage, '-f']);
    versionSpinner.success();
}
catch (error) {
    versionSpinner.error();
    console.error(chalk.red('\nⓧ Unable to bump version.'));
    process.exit(1);
}
let pushSpinner;
try {
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    let remote = await git.remote(['get-url', 'origin']);
    if (!remote) {
        console.log(chalk.yellow('\n⚠ Unable to determine remote. Skipping push.'));
    }
    else {
        remote = remote.trim();
        const push = await promptPushChanges();
        if (push) {
            pushSpinner = createSpinner('pushing changes', { color: 'gray' });
            pushSpinner.start();
            await git.push(remote, currentBranch);
            await git.pushTags(remote);
            pushSpinner.success();
        }
    }
}
catch (error) {
    if (pushSpinner) {
        pushSpinner.error();
    }
    console.log(error);
    console.log(chalk.red('\nⓧ Unable to push changes. Please push manually.'));
}
console.log(chalk.green('\n✔ Version bumped successfully!'));
async function promptBumpType() {
    bumpType = (await inquirer.prompt([
        {
            type: 'list',
            name: 'bumpType',
            message: 'What type of version bump would you like to make?',
            choices: validBumpTypes,
        },
    ])).bumpType;
}
async function promptCommitMessage() {
    commitMessage = (await inquirer.prompt([
        {
            type: 'input',
            name: 'commitMessage',
            message: 'What commit message would you like to use?',
            default: 'bump version',
        },
    ])).commitMessage;
}
async function promptCommitChanges() {
    const confirm = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'commitChanges',
            message: 'Would you like to commit these changes with the bump?',
        },
    ]);
    return confirm.commitChanges;
}
async function promptPushChanges() {
    const confirm = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'pushChanges',
            message: 'Would you like to push these changes to the remote?',
        },
    ]);
    return confirm.pushChanges;
}
function displayHelp() {
    console.log(chalk.green('Usage: bump [options] <patch|minor|major> [commitMessage]'));
    console.log('\nOptions:');
    console.log('  -h, --help     Display this help message.\n');
    console.log('Arguments:');
    console.log('  <patch|minor|major>    Type of version bump to apply.');
    console.log('  [commitMessage]        Optional commit message (default: "bump version").');
}
//# sourceMappingURL=index.js.map