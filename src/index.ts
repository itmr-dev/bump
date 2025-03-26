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

let interrupted = false;
let isExiting = false;
let cleanup: { type: 'stash' | 'version', data?: any }[] = [];

// Prevent multiple error messages
function handleExit(code: number) {
  if (!isExiting) {
    isExiting = true;
    process.exit(code);
  }
}

async function performCleanup() {
  console.log(chalk.yellow('\n\nCleaning up...'));
  
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
  
  if (cleanup.length > 0) {
    await performCleanup();
    console.log(chalk.green('\n✔ Cleanup completed'));
  }
  
  handleExit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  // Skip errors during user interruption
  if (!interrupted && !isExiting) {
    console.error(chalk.red('\nⓧ An unexpected error occurred:'));
    console.error(error);
    handleExit(1);
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

interface BumpConfig {
  bumpType: string;
  commitMessage: string;
  preId: string;
  verbose: boolean;
  stashChanges: boolean;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const config: BumpConfig = {
      bumpType: args[0],
      commitMessage: args[1],
      preId: '',
      verbose: false,
      stashChanges: false
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

    console.log(chalk.cyan('ℹ'), chalk.white('Welcome to bump!'));

    if (config.verbose) console.log(chalk.cyan('ℹ'), chalk.white('verbose logging enabled'));

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
      console.error(chalk.red('\nⓧ Unable to check git status.'));
      if (config.verbose) console.error(error);
      handleExit(1);
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
        console.error(chalk.red('\nⓧ Unable to stash your changes.'));
        if (config.verbose) console.error(error);
        handleExit(1);
        return;
      }
    }

    let failed = false;
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
        failed = true;
      }
    } catch (error) {
      versionSpinner.error();
      console.error(chalk.red('\nⓧ Unable to bump version.'));
      // @ts-ignore
      if (error.message && error.message.includes('already exists')) {
        console.log(chalk.red('Tag already exists. Please push the changes manually, fix the package.json or delete it.'));
      }
      if (config.verbose) console.error(error);
      if (!config.stashChanges) handleExit(1);
      failed = true;
    }

    if (config.stashChanges) {
      try {
        stashingSpinner?.update({ text: 'restoring stashed changes' });
        await git.stash(['pop']);
        cleanup = cleanup.filter(item => item.type !== 'stash');
        if (failed) {
          stashingSpinner?.clear();
          console.log(chalk.yellow('⚠ Stashed changes restored. Exiting now…'));
          handleExit(1);
          return;
        } else {
          stashingSpinner?.success();
        }
      } catch (error) {
        stashingSpinner?.error();
        versionSpinner.error();
        console.error(chalk.red('\nⓧ Unable to restore stashed changes.'));
        if (config.verbose) console.error(error);
        handleExit(1);
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
      console.log(chalk.red('\nⓧ Unable to push changes. Please push manually.'));
      if (config.verbose) console.error(error);
    }

    if (!interrupted) {
      cleanup = []; // Clear cleanup as everything succeeded
      console.log(chalk.green('\n✔ Version bumped successfully!'));
    }

  } catch (error) {
    if (!interrupted) {
      console.error(chalk.red('\nⓧ An unexpected error occurred:'));
      console.error(error);
      handleExit(1);
    }
  }
}

async function promptBumpType(): Promise<string> {
  const mainChoices = ['patch', 'minor', 'major', new inquirer.Separator(), 'other'];
  
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: 'What type of version bump would you like to make?',
      choices: mainChoices,
    },
  ]);

  if (choice === 'other' && !interrupted) {
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
    if (otherChoice === 'back' && !interrupted) {
      // Clear pre-release prompt before going back
      clearLines(1);
      return promptBumpType();
    }
    return otherChoice;
  }
  return choice;
}

async function promptIfPreId(): Promise<boolean> {
  return (await inquirer.prompt([
    {
      type: 'confirm',
      name: 'modifier',
      message: 'Would you like to add a modifier to the version?',
    },
  ])).modifier;
}

async function promptPreId(defaultPreId = ''): Promise<string> {
  return (await inquirer.prompt([
    {
      type: 'input',
      name: 'modifier',
      message: 'What modifier would you like to add?',
      default: defaultPreId,
    },
  ])).modifier;
}

async function promptCommitMessage(): Promise<string> {
  return (await inquirer.prompt([
    {
      type: 'input',
      name: 'commitMessage',
      message: 'What commit message would you like to use?',
      default: 'bump version',
    },
  ])).commitMessage;
}

async function promptCommitChanges(): Promise<boolean> {
  const confirm = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'commitChanges',
      message: 'Would you like to commit these changes with the bump?',
    },
  ]);
  return confirm.commitChanges;
}

async function promptContinueEvenThoChanges(): Promise<boolean> {
  const confirm = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'stillContinue',
      message: 'Would you like proceed with the bump, without including your changes?',
    },
  ]);
  return confirm.stillContinue;
}

async function promptPushChanges(): Promise<boolean> {
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
  console.log(chalk.green('Usage: bump [options] <version-type> [commitMessage]'));
  console.log('\nVersion types:');
  console.log('  patch|minor|major       Standard version increments');
  console.log('  premajor|preminor      Pre-release version increments');
  console.log('  prepatch|prerelease    Additional pre-release options\n');
  console.log('Options:');
  console.log('  -h, --help               Display this help message.\n');
  console.log('      --setup-workflows    Setup automatic Docker image build workflows for GitHub.');
  console.log('                           This is perfect if you also use itmr-dev/blaze for your ci/cd\n');
  console.log('Arguments:');
  console.log('  <version-type>         Type of version bump to apply (see Version types above)');
  console.log('  [commitMessage]        Optional commit message (default: "bump version")');
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
main().catch((error) => {
  if (!interrupted && !isExiting) {
    console.error(chalk.red('\nⓧ An unexpected error occurred:'));
    console.error(error);
    handleExit(1);
  }
});
