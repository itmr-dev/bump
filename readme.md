<!--p align="center"><a href="#" target="_blank" rel="noopener noreferrer"><img width="100" src="assets/blaze.png" alt="bump logo"></a></p-->

<h1 align="center">bump</h1>

<p align="center">
<a href="https://www.npmjs.com/package/@itmr.dev/bump" title="open on npm"><img alt="NPM Version" src="https://img.shields.io/npm/v/%40itmr.dev%2Fbump"></a>
<a href="https://github.com/itmr-dev/bump" title="Go to GitHub repo"><img src="https://img.shields.io/static/v1?label=itmr-dev&amp;message=bump&amp;color=blue&amp;logo=github" alt="itmr-dev - bump"></a>
<!--a href="https://github.com/itmr-dev/bump/actions?query=workflow:&quot;prod+ci&quot;"><img src="https://github.com/itmr-dev/bump/workflows/prod%20ci/badge.svg" alt="prod ci"></a-->
<a href="https://github.com/itmr-dev/bump/issues"><img src="https://img.shields.io/github/issues/itmr-dev/bump" alt="issues - bump"></a>
</p>

Welcome to Bump, a command-line tool designed to automate the process of version bumping in your package.json and applying git tags. This tool simplifies your workflow, ensuring consistent versioning practices and making your release process smoother and more efficient.

## Features

- Easy version bumping: Automatically updates the version in your package.json file and applies a git tag.
- Supports semantic versioning: Choose from major, minor, or patch versions.
- Customizable commit messages: Add a personalized message for the version bump commit.
- GitHub workflows setup: Optionally set up GitHub workflows for automatic Docker image builds, suitable for CI/CD pipelines.
- User-friendly: Provides interactive prompts and validations to guide you through the process.

## Installation

Bump is available on npm and can be installed globally with the following command:

```bash
npm install -g @itmr.dev/bump
```

This will install Bump globally on your system, allowing you to use it in any of your projects.

## Usage

Navigate to the root of your project and run:

```bash
bump <version_type> [commit_message]
```

- <version_type>: Required. Specify the type of version bump (major, minor, patch).
- [commit_message]: Optional. Customize the commit message for the version bump (default: "bump version").

### Options

- -h, --help: Displays help information and available options.
- -v, --verbose: Enable verbose logging.
- -y, --yes: Never prompt, use defaults. Implied when stdin is not a TTY or when `CI` is set.
- --preid <id>: Pre-release identifier, e.g. `--preid beta`.
- --push / --no-push: Push (or don't push) the commit and tags without asking.
- --force-branch: Allow bumping on branches other than the allowed ones.
- --setup-workflows: Sets up GitHub workflows for automatic Docker image builds, enhancing your CI/CD pipeline.

Options may appear anywhere, before or after the arguments.

### Example Commands

Bump the patch version with the default commit message:

```bash
bump patch
```

Bump the minor version with a custom commit message:

```bash
bump minor "Add new features"
```

Initialize GitHub workflows for Docker:

```bash
bump --setup-workflows
```

## Non-interactive use (CI and AI agents)

Bump never prompts when stdin is not a TTY, when `CI` is set, or when you pass `--yes`. In that mode it is safe to run unattended:

```bash
bump patch "release" --push
bump prerelease "nightly" --preid beta --push
```

What non-interactive mode does:

- The version type is required, an invalid or missing one exits `1` instead of opening a menu.
- The commit message defaults to `bump version`.
- Uncommitted changes are included in the bump commit.
- Nothing is pushed unless you pass `--push`.
- The self-update check is skipped, so bump never exits early to update itself mid-pipeline.
- Unknown options exit `1` rather than being silently ignored.

Exit code is `0` on success and `1` on failure, and any partial bump is rolled back (version commit and tag removed, stashed changes restored).

## Contributing

Contributions are welcome! Feel free to fork the repository, make your changes, and submit a pull request. If you encounter any issues or have suggestions for improvements, don't hesitate to open an issue.
