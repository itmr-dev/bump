# Changelog

## 2.1.0

### Please read

- **Requires Node.js 22.13 or newer** (`^22.13.0 || >=23.5.0`). The updated dependencies dropped Node 18 and 20.
- **On an older Node, bump says so** instead of crashing, and points to `npm install -g @itmr.dev/bump@2.0.1`, the last version that runs on Node 18 and 20. Set `"autoUpdate": false` in `~/.bumprc` afterwards, otherwise 2.0.1 updates itself straight back.
- **Auto-update never installs a version your Node can't run.** It shows a notice to update Node.js instead.

### Changed

- **All dependencies updated to their latest versions:** chalk 6, execa 10, inquirer 14, simple-git 4, nanospinner 1.2 and TypeScript 7.
- **The update notice is now a framed box**, shown once after an update to 2.1.0 or any new major.

### Fixed

- **The update notice keeps all its lines.** The update spinner erased the line above it: the changelog link of the update notice, or "Welcome to bump!". This happened with nanospinner 1.2, which global installs of 2.x already picked up.
- **Ctrl+C mid-bump always rolls back.** nanospinner 1.2 exits the process on Ctrl+C while spinning; bump now keeps its own handler in charge so the rollback runs.

## 2.0.1

- Each adapter now lives in its own file under `src/adapters/`, which makes adding a format a single-file PR. No behaviour change.

## 2.0.0

bump is no longer npm-only. It now finds the version files in your project, bumps all of them, and creates the commit and tag itself instead of calling `npm version`.

### New

- **Works beyond npm.** Supported out of the box:
  - `package.json` (plus `package-lock.json`)
  - Expo `app.json`
  - PlatformIO `library.json`
  - Arduino `library.properties`
  - `Cargo.toml`
  - `pyproject.toml`
  - Flutter `pubspec.yaml`, where the `+N` build number is incremented too
  - Helm `Chart.yaml`
- **Every version file found is bumped together.** If they disagree on the current version, bump stops and lists them.
- **Custom version files via `.bump.json`** in the repo root, e.g. a `custom_version` in `platformio.ini` or a `#define` in a header. See the [README](readme.md#custom-version-files-bumpjson).
- **Git tags only.** Repos without a version file (Go, PlatformIO firmware using `git describe`, …) are bumped by creating the next `vX.Y.Z` tag.
- **One-time notice** after a major update, linking here.

### Changed (please read)

- **`npm version` is no longer used.**
  - npm's `preversion`, `version` and `postversion` scripts still run.
  - `.npmrc` settings that `npm version` honoured (`tag-version-prefix`, `sign-git-tag`, `git-tag-version`, `commit-hooks`) are no longer read.
  - Tags are always `v<version>`.
  - Git commit hooks still run as usual.
- **A `package.json` is no longer required.** bump runs in any git repo. Without a version file it uses git tags only.
- **Only the version text is changed** in your files, so formatting is kept. The exception is `package-lock.json`, which is rewritten the way npm writes it.
- **Version files only.** Expo `ios.buildNumber` and `android.versionCode` are not touched (EAS auto-increment covers them).

### Fixed

- **Rollback never discards your work.** If a bump fails, bump undoes its commit and tag, restores your version files to exactly what was on disk, and keeps every other file. Uncommitted edits stay. The dropped commit is printed so it can be recovered.
- **A rejected commit fails the bump.** A pre-commit hook that rejects the commit now fails the bump instead of tagging the previous commit.
- **Pre-release versions get updates.** The update check now understands pre-releases, so `1.6.0-beta.0` is offered `1.6.0`.

## 1.x

See the [git history](https://github.com/itmr-dev/bump/commits/main).
