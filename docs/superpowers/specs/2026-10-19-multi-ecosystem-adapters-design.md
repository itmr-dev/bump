# Multi-ecosystem bumping via adapters

## Why

bump only works in npm projects: it refuses to run without a `package.json` and delegates the
version change, commit and tag to `npm version` (`src/index.ts:244`, `:411-420`). The owner wants
to use bump on PlatformIO firmware/libraries, Rust, Python, Flutter, Helm etc., and wants new
ecosystems to be easy for outside contributors to add via PR.

## Goals

- bump computes the next version itself and writes it into every version file the project has,
  then commits and tags itself. `npm version` is no longer called.
- Ecosystem support lives in **adapters**. The common case is a few lines of data (file name +
  regex with one capture group for the version). Code is allowed only for odd formats.
- Repos with a one-off version location (e.g. `-DFW_VERSION="1.2.3"` in `platformio.ini`, a
  `version.h`) declare it in a per-repo config file, no PR to bump needed.
- Repos where no adapter matches fall back to **tag-only**: current version = latest git tag,
  bump just creates the next tag.
- Everything else (branch check, stash, push, cleanup/revert, non-interactive mode, prompts,
  flags, commit message format, `v`-prefixed tags) behaves exactly as today.

## Non-goals

- Maven, Gradle, iOS pbxproj, Unity, .NET, `app.config.js/ts`, Python `dynamic` versions,
  Cargo `version.workspace = true` members. Later, as adapters.
- Monorepos / multiple packages with different versions.
- Plugin loading from npm packages. Adapters live in this repo.

## Anti-goals (failure even if it "works")

- Reformatting a user's file. Only the version text on the matched line may change.
- Silently bumping the wrong `version` (e.g. a dependency's). If a pattern matches zero or more
  than one place, abort before writing anything.
- Committing when matched files disagree on the current version. Abort and list them.
- Regressing existing npm users: `package-lock.json` must still be updated, and
  `preversion` / `version` / `postversion` npm scripts must still run, as `npm version` did.

## Behaviour

1. Detect: every built-in adapter whose file exists in cwd, plus every entry from the repo
   config. Print which ones matched (e.g. `ℹ versions found in: package.json, app.json`).
2. Read the current version from each. All must be equal, else abort listing file → version.
   If none matched: tag-only, current = latest tag (`git describe --tags --abbrev=0`, leading
   `v` stripped). No tags at all → `0.0.0`.
3. Next version: same semantics as `npm version <type> [--preid]` today. Uses the `semver`
   package (`semver.inc`), which is what npm uses, so results are identical.
4. Write each file, then re-read it and confirm it now holds the new version.
5. If `package.json` matched: run `npm run preversion` before writing, `npm run version` after
   writing (before commit), `npm run postversion` after tagging, each only if the script exists.
6. `git add .` (as today), commit `(<version>) <message>\n\ncommited using @itmr.dev/bump`,
   annotated tag `v<version>` with the same message. In tag-only mode, commit only if something
   is staged; otherwise just tag. The cleanup/revert step must know whether a commit was made
   (today it always does `reset --hard HEAD~1`).

### Match rules

- Built-in adapter, file exists but pattern finds nothing (React Native `app.json`, ruff-only
  `pyproject.toml`, virtual Cargo workspace, private `package.json` without version): **skip**
  it, mention in verbose output. More than one match: abort.
- `.bump.json` entry: the owner declared it, so zero or several matches both abort.
- `package-lock.json` only runs when `package.json` matched, follows it, and is not part of the
  consistency check (stale lock versions are common).
- Consistency compares versions with build metadata stripped (`1.2.3+7` equals `1.2.3`).

### Non-semver versions

- Current version is parsed with `semver.coerce` only when it's `x` or `x.y` (Arduino's
  `version=1.0` becomes `1.0.0`, written back as `1.0.1`). Anything else non-semver aborts with
  file + value.
- Prereleases are written semver-style (`1.2.4-beta.0`) everywhere. pip normalises that to
  PEP 440 (`1.2.4b0`), so pyproject is fine.
- Tag-only mode takes the highest semver tag from `git tag` (leading `v` stripped), ignoring
  tags that aren't semver (`release-5`), instead of `git describe`.

### Flutter `+N`

Incremented when present (`1.2.3+7` → `1.2.4+8`), not added when absent. The git tag never
carries it (`v1.2.4`).

## Adapter shape

```ts
{ name: 'cargo', file: 'Cargo.toml', pattern: /^\[(?:workspace\.)?package\][^\[]*?^version\s*=\s*"([^"]+)"/m }
```

Read = capture group 1. Write = replace only the capture group span. Optional code hooks
(`read(text)` / `write(text, version)`) for formats a single regex can't express.

### First batch of built-ins

| name | file | where |
|---|---|---|
| npm | `package.json` | top-level `"version"` (cross-checked with `JSON.parse`) |
| npm-lock | `package-lock.json` | top-level `version` and `packages[""].version` (JSON rewrite, 2-space indent, trailing newline, as npm writes it) |
| expo | `app.json` | `expo.version` |
| platformio-lib | `library.json` | top-level `"version"` |
| arduino-lib | `library.properties` | `version=` line |
| cargo | `Cargo.toml` | `version` in `[package]` or `[workspace.package]` |
| python | `pyproject.toml` | `version` in `[project]` or `[tool.poetry]`; skip if `dynamic` contains `version` |
| flutter | `pubspec.yaml` | `version: x.y.z+N`, keeps and increments `+N` |
| helm | `Chart.yaml` | column-0 `version:` (not `appVersion`) |

Expo `ios.buildNumber` / `android.versionCode` are not touched (EAS auto-increment covers them).

## Per-repo config

`.bump.json` in the repo root, optional:

```json
{
  "files": [
    { "path": "platformio.ini", "pattern": "custom_version\\s*=\\s*(\\S+)" },
    { "path": "include/version.h", "pattern": "#define FW_VERSION \"([^\"]+)\"" }
  ]
}
```

Same rules as built-ins: exactly one match, capture group 1 is the version. Invalid JSON or
regex → abort with the file name. (The global `~/.bumprc` stays for user preferences.)

## Decided by Claude (owner may veto)

- New dependency `semver` for version math: correctness on prerelease edge cases over saving a
  dependency, and it matches npm's behaviour exactly.
- Config file name `.bump.json`.
- Tag-only with no tags starts from `0.0.0`.
- Flutter `+N` is incremented on every bump.
- npm lifecycle scripts are kept.
- Built-in with no match is skipped; `.bump.json` with no match aborts.
- `x` / `x.y` versions are coerced; other non-semver aborts.
- `.npmrc` settings that `npm version` honoured (`tag-version-prefix`, `sign-git-tag`,
  `git-tag-version`, `commit-hooks`) are **not** read any more. Mentioned in the README.
- No way to exclude a built-in via `.bump.json` yet; add when a repo needs it.

## Left to the builder

- File layout (suggestion: `src/adapters.ts`, `src/version.ts`, keep `index.ts` as the flow).
- Exact regexes, provided they pass fixture tests.
- Help text and README updates (list of supported files, `.bump.json` example).
- Tests: `node --test` like `test/args.test.js`, covering version math, each adapter's
  read/write on a fixture string (formatting preserved), and the 0/2-match abort.
