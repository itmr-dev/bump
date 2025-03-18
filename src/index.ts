#!/usr/bin/env node

import chalk from 'chalk';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { createSpinner } from 'nanospinner';
import { simpleGit } from 'simple-git';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const git = simpleGit();

const validBumpTypes = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];

const args = process.argv.slice(2);
let [bumpType, commitMessage] = args;
let preId = '';

if (args.includes('-h') || args.includes('--help')) {
  displayHelp();
  process.exit(0);
}
let verbose = false;
if (args.includes('--verbose') || args.includes('-v')) {
  verbose = true;
}

console.log(chalk.cyan('ℹ'), chalk.white('Welcome to bump!'));

if (verbose) console.log(chalk.cyan('ℹ'), chalk.white('verbose logging enabled'));

if (args.includes('--setup-workflows')) {
  const spinner = createSpinner('Setting up GitHub workflows', { color: 'gray' });
  await setupGithubWorkflows();
  spinner.success();
  console.log(chalk.green('✔ Workflows setup successfully!'));
  process.exit(0);
}

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
} else {
  if (!validBumpTypes.includes(bumpType)) {
    console.log(chalk.red('\nⓧ Invalid version type provided.'));
    await promptBumpType();
  }
}

if (bumpType.includes('pre')) {
  const preIdWanted =  await promptIfPreId();
  if (preIdWanted) {
    preId = await promptPreId();
  }
}

if (!commitMessage) {
  console.log(chalk.red('\nⓧ No commit message provided.'));
  await promptCommitMessage();
}

const gitStatusSpinner = createSpinner('checking git status', { color: 'gray' });
gitStatusSpinner.start();

let stashChanges = false;
try {
  const gitStatus = await git.status();
  gitStatusSpinner.success();
  if (gitStatus.files.length > 0) {
    console.log(chalk.yellow('\n⚠ You have uncommitted changes'));
    const commit = await promptCommitChanges()
    if (!commit) {
      stashChanges = await promptContinueEvenThoChanges()
      if (!stashChanges) {
        console.log(chalk.red('\nⓧ Aborting...'));
        process.exit(1);
      }
    }
  }
} catch (error) {
  gitStatusSpinner.error();
  console.error(chalk.red('\nⓧ Unable to check git status.'));
  if (verbose) console.error(error);
  process.exit(1);
}

const versionSpinner = createSpinner('bumping version', { color: 'gray' });
versionSpinner.start();

let stashingSpinner;
if (stashChanges) {
  try {
    stashingSpinner = createSpinner('stashing your changes', { color: 'gray' });
    stashingSpinner.start();
    await git.stash(['push', '-m', `(bump) automated stash from ${new Date().toISOString()}`]);
  } catch (error) {
    stashingSpinner?.error();
    versionSpinner.error();
    console.error(chalk.red('\nⓧ Unable to stash your changes.'));
    if (verbose) console.error(error);
    process.exit(1);
  }
}

let failed = false;
try {
  await git.add('.');
  const npmArgs = ['version', bumpType, '-m', `(%s) ${commitMessage}\n\ncommited using @itmr.dev/bump`, '-f'];
  if (preId) {
    npmArgs.push(`--preid=${preId}`);
  }
  await execa('npm', npmArgs);
  versionSpinner.success();
} catch (error) {
  versionSpinner.error();
  console.error(chalk.red('\nⓧ Unable to bump version.'));
  // @ts-ignore
  if (error.message && error.message.includes('already exists')) {
    console.log(chalk.red('Tag already exists. Please push the changes manually, fix the package.json or delete it.'));
  }
  if (verbose) console.error(error);
  if (!stashChanges) process.exit(1);
  failed = true;
}

if (stashChanges) {
  try {
    stashingSpinner?.update({ text: 'restoring stashed changes' });
    await git.stash(['pop']);
    if (failed) {
      stashingSpinner?.clear();
      console.log(chalk.yellow('⚠ Stashed changes restored. Exiting now…'));
      process.exit(1);
    } else {
      stashingSpinner?.success();
    }
  } catch (error) {
    stashingSpinner?.error();
    versionSpinner.error();
    console.error(chalk.red('\nⓧ Unable to restore stashed changes.'));
    if (verbose) console.error(error);
    process.exit(1);
  }
}

let pushSpinner;
try {
  const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
  let remote = await git.remote(['get-url', 'origin']);
  if (!remote) {
    console.log(chalk.yellow('\n⚠ Unable to determine remote. Skipping push.'));
  } else {
    remote = remote.trim();
    const push = await promptPushChanges();
    if (push) {
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
  console.log(chalk.red('\nⓧ Unable to push changes. Please push manually.'));
  if (verbose) console.error(error);
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

async function promptIfPreId() {
  return (await inquirer.prompt([
    {
      type: 'confirm',
      name: 'modifier',
      message: 'Would you like to add a modifier to the version?',
    },
  ])).modifier;
}

async function promptPreId() {
  return (await inquirer.prompt([
    {
      type: 'input',
      name: 'modifier',
      message: 'What modifier would you like to add?',
    },
  ])).modifier;
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

async function promptContinueEvenThoChanges() {
  const confirm = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'stillContinue',
      message: 'Would you like proceed with the bump, without including your changes?',
    },
  ]);
  return confirm.stillContinue;
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
  console.log('  -h, --help               Display this help message.\n');
  console.log('      --setup-workflows    Setup automatic Docker image build workflows for GitHub.');
  console.log('                           This is perfect if you also use itmr-dev/blaze for your ci/cd\n');
  console.log('Arguments:');
  console.log('  <patch|minor|major>    Type of version bump to apply.');
  console.log('  [commitMessage]        Optional commit message (default: "bump version").');
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