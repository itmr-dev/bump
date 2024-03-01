# Bump

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
- --setup-workflows: Sets up GitHub workflows for automatic Docker image builds, enhancing your CI/CD pipeline.

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

## Contributing

Contributions are welcome! Feel free to fork the repository, make your changes, and submit a pull request. If you encounter any issues or have suggestions for improvements, don't hesitate to open an issue.