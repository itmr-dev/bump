# Multi-ecosystem Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `npm version` with bump's own version math + file adapters, so bump works in npm, Expo, PlatformIO/Arduino, Cargo, Python, Flutter, Helm and tag-only repos.

**Architecture:** `src/version.ts` holds pure version math (semver). `src/adapters.ts` holds the adapter list, regex read/write, `.bump.json` loading and detection. `src/index.ts` keeps the existing flow and swaps the `npm version` block for detect → check → write → commit → tag.

**Tech Stack:** TypeScript (NodeNext ESM), `semver` (new dep), simple-git, execa, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-multi-ecosystem-adapters-design.md`

## Global Constraints

- Commit message: `(<version>) <message>\n\ncommited using @itmr.dev/bump` (typo "commited" kept, as today).
- Tag: annotated, `v<version>`, same message as the commit. Never includes Flutter `+N`.
- Only the captured version span of a file changes; everything else byte-identical.
- Built-in adapter: 0 matches → skip; >1 → abort. `.bump.json` entry: 0 or >1 → abort.
- `package-lock.json` follows `package.json`, never in the consistency check.
- Consistency compares versions with build metadata stripped.
- Coerce only `x` / `x.y`; other non-semver aborts naming file and value.
- npm `preversion` / `version` / `postversion` scripts run when `package.json` matched and the script exists.
- Tests: `node --test` against compiled `lib/`, like `test/args.test.js`. `npm test` runs `tsc` first.

## Review Focus

- `package.json` whose first `"version"` key is nested (e.g. inside `"engines"` before top-level) → must read the top-level one. Test in Task 2 (cross-check with `JSON.parse`).
- CRLF files → write keeps `\r\n`. Test in Task 2.
- `Cargo.toml` with `version = ` under `[dependencies.foo]` before/after `[package]` → only `[package]` touched. Test in Task 2.
- `.bump.json` with invalid regex or invalid JSON → abort naming `.bump.json`, not a stack trace. Test in Task 2.
- Tag-only repo with no commits to stage → tag created, no empty commit, revert deletes only the tag. Covered by manual check in Task 3.

---

### Task 1: Version math

**Files:**
- Modify: `package.json` (add `semver` dependency, `@types/semver` devDependency via `yarn add`)
- Create: `src/version.ts`
- Test: `test/version.test.js`

**Interfaces:**
- Produces:
  - `parseVersion(raw: string): string | null`: strips leading `v` and `+build`; returns valid semver; coerces `x`/`x.y` to `x.0.0`/`x.y.0`; else `null`.
  - `nextVersion(current: string, type: string, preid?: string): string`: `semver.inc` on `parseVersion(current)`; throws `Error` with the value if invalid.
  - `highestTag(tags: string[]): string | null`: highest semver among tags (after `parseVersion`, but excluding coerced ones like `5`), `null` if none.

- [ ] **Step 1: Write failing tests** in `test/version.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, nextVersion, highestTag } from '../lib/version.js';

test('parseVersion', () => {
  assert.equal(parseVersion('v1.2.3'), '1.2.3');
  assert.equal(parseVersion('1.2.3+7'), '1.2.3');
  assert.equal(parseVersion('1.0'), '1.0.0');
  assert.equal(parseVersion('2'), '2.0.0');
  assert.equal(parseVersion('1.2.3rc1'), null);
  assert.equal(parseVersion('release-5'), null);
});

test('nextVersion matches npm version', () => {
  assert.equal(nextVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(nextVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersion('1.2.3', 'prepatch', 'beta'), '1.2.4-beta.0');
  assert.equal(nextVersion('1.2.4-beta.0', 'prerelease', 'beta'), '1.2.4-beta.1');
  assert.equal(nextVersion('1.2.3', 'premajor'), '2.0.0-0');
  assert.equal(nextVersion('1.0', 'patch'), '1.0.1');
  assert.throws(() => nextVersion('1.2.3rc1', 'patch'), /1\.2\.3rc1/);
});

test('highestTag ignores non-semver tags', () => {
  assert.equal(highestTag(['v1.2.0', 'release-5', 'v1.10.0', 'v1.9.9']), '1.10.0');
  assert.equal(highestTag(['release-5', '7']), null);
  assert.equal(highestTag([]), null);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (cannot find `lib/version.js`).
- [ ] **Step 3:** `yarn add semver && yarn add -D @types/semver`, implement `src/version.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add package.json yarn.lock src/version.ts test/version.test.js && git commit -m "add own version math"` (also stage `lib/` since it is tracked).

### Task 2: Adapters, `.bump.json`, detection

**Files:**
- Create: `src/adapters.ts`
- Test: `test/adapters.test.js`

**Interfaces:**
- Consumes: `parseVersion` from Task 1.
- Produces:

```ts
export interface Adapter {
  name: string;
  file: string;
  pattern?: RegExp;              // non-global, exactly one capture group = version
  read?(text: string): string | null;            // overrides pattern read
  write?(text: string, version: string): string; // overrides pattern write
  strict?: boolean;              // true for .bump.json entries: 0 matches aborts
  follows?: string;              // name of adapter it depends on; skipped otherwise, excluded from consistency
}
export interface VersionFile { adapter: Adapter; path: string; current: string } // current = raw captured text
export const builtins: Adapter[];
export function readVersion(adapter: Adapter, text: string): string | null; // throws if >1 match, or 0 and strict
export function writeVersion(adapter: Adapter, text: string, version: string): string;
export function loadRepoAdapters(cwd: string): Adapter[]; // reads .bump.json, [] if absent; throws Error mentioning '.bump.json' on bad JSON/regex
export function detect(cwd: string): VersionFile[];       // builtins + repo adapters whose file exists and readVersion !== null
```

Built-ins (names exactly): `npm`, `npm-lock` (`follows: 'npm'`, JSON read/write of `version` and `packages[""].version`, 2-space indent, trailing `\n`), `expo` (`app.json` `expo.version`), `platformio-lib` (`library.json`), `arduino-lib` (`library.properties`, `^version=(.+)$`m), `cargo`, `python` (read returns `null` when `[project]` `dynamic` contains `"version"`), `flutter` (write increments `+N` when present), `helm` (`^version:\s*(\S+)`m).

Match counting: build a `g`-flag copy of `pattern` and count matches. Write replaces only the capture-group span (compute its offset with the `d` flag / `indices`), so surrounding bytes incl. `\r\n` are untouched. `npm` and `expo` read cross-check the regex result against `JSON.parse` and use the top-level/`expo` key; if the regex alone is ambiguous, locate the span by searching after the key's position in the correct object — the implementer picks the method, the CRLF and nested-`version` tests decide.

- [ ] **Step 1: Write failing tests** in `test/adapters.test.js`. One test per built-in: read from a fixture string, write `9.9.9`, assert the result equals the fixture with only the version replaced. Plus:

```js
test('package.json: nested version before top-level', () => {
  const t = '{\n  "engines": { "version": "0.1.0" },\n  "version": "1.2.3"\n}\n';
  // fixture order is deliberate; top-level must win
  assert.equal(readVersion(npm, t), '1.2.3');
  assert.equal(writeVersion(npm, t, '1.2.4'), t.replace('"1.2.3"', '"1.2.4"'));
});
test('CRLF preserved', () => { /* library.properties with \r\n; written text still has \r\n on every line */ });
test('cargo ignores dependency tables', () => { /* [dependencies.foo]\nversion = "0.1"\n[package]\nversion = "1.2.3" → only 1.2.3 changes */ });
test('python dynamic version is skipped', () => { /* [project]\ndynamic = ["version"] → readVersion === null */ });
test('flutter +N increments, absent stays absent', () => {
  assert.equal(writeVersion(flutter, 'version: 1.2.3+7\n', '1.2.4'), 'version: 1.2.4+8\n');
  assert.equal(writeVersion(flutter, 'version: 1.2.3\n', '1.2.4'), 'version: 1.2.4\n');
});
test('helm leaves appVersion alone', () => { /* version: 1.2.3\nappVersion: "1.2.3" → only first changes */ });
test('two matches throws', () => { /* library.properties with two version= lines → throws */ });
test('strict zero matches throws, builtin zero matches is null', () => { ... });
test('.bump.json bad JSON / bad regex throw mentioning .bump.json', () => { /* use fs.mkdtempSync in os.tmpdir() */ });
test('detect skips npm-lock without package.json', () => { /* tmp dir with only package-lock.json → [] */ });
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (no `lib/adapters.js`).
- [ ] **Step 3: Implement** `src/adapters.ts`.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `git add src/adapters.ts test/adapters.test.js lib && git commit -m "add version file adapters"`.

### Task 3: Wire into the CLI

**Files:**
- Modify: `src/index.ts:243-251` (workdir check), `:133-174` (cleanup), `:408-432` (bump block), `:586-620` (help)
- Modify: `readme.md`

**Interfaces:**
- Consumes: `detect`, `writeVersion`, `readVersion` (Task 2); `parseVersion`, `nextVersion`, `highestTag` (Task 1).

- [ ] **Step 1: Workdir check:** drop the `package.json` requirement; keep the git-repo check. Call `detect(process.cwd())` here (errors from `.bump.json` → red message + `handleExit(1)`), print `ℹ versions found in: <paths>` or `ℹ no version files found, using git tags only`. Non-follower files must agree on `parseVersion(current)`; else print each `path → current` and abort. Tag-only current = `highestTag((await git.tags()).all) ?? '0.0.0'`. Compute `newVersion = nextVersion(...)` here so errors happen before any change.
- [ ] **Step 2: Bump block:** replace both `execa('npm', …)` calls with: run `npm run preversion` (if `npm` matched and script exists) → write each file via `writeVersion`, re-read with `readVersion` and assert `parseVersion(...) === newVersion` → `npm run version` → `git add .` → commit (skip in tag-only mode when `git status` shows nothing staged) → `git tag -a v<newVersion> -m <message>` → `npm run postversion`. Push `cleanup` entry `{ type: 'version', data: { tag: 'v' + newVersion, committed: boolean } }` right after the tag/commit.
- [ ] **Step 3: Cleanup:** in `performCleanup`, only `reset --hard HEAD~1` when `item.data.committed`; if files were written but commit failed, `git checkout -- <paths>`. Always delete the tag if set.
- [ ] **Step 4: Help + README:** list supported files (the built-in table from the spec), `.bump.json` example, tag-only fallback, and a "Breaking" note that `.npmrc` `tag-version-prefix`, `sign-git-tag`, `git-tag-version`, `commit-hooks` are no longer read. Update the intro sentence ("…in your package.json…") to say version files.
- [ ] **Step 5: Verify** `npm test` passes, then manual runs in scratch repos (`git init`, one commit, `--force-branch -y`, no remote):
  - npm repo with `package.json` + `package-lock.json` + a `version` script → both files bumped, script ran, tag `v1.0.1`.
  - Flutter `pubspec.yaml` `1.0.0+3` + `patch` → `1.0.1+4`, tag `v1.0.1`.
  - `.bump.json` pointing at `platformio.ini` `custom_version` → bumped.
  - Empty repo, tags `v0.3.0`, `release-5` → tag `v0.3.1`, no new commit.
  - `package.json` 1.0.0 + `app.json` 1.1.0 → aborts listing both, nothing changed.
- [ ] **Step 6: Commit** `git add src/index.ts readme.md lib docs && git commit -m "bump any project via version file adapters"`.
