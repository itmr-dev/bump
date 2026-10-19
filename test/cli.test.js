import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const bin = fileURLToPath(new URL('../lib/index.js', import.meta.url));

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bump-cli-'));
  const sh = cmd => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString();
  sh('git init -q -b main && git config user.email t@t && git config user.name t');
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  sh('git add . && git commit -qm init');
  return { dir, sh, read: f => readFileSync(join(dir, f), 'utf8') };
}

// HOME points at the repo so ~/.bumprc of the developer is never touched
const bump = (dir, ...args) => spawnSync('node', [bin, '-y', '--force-branch', '--no-push', ...args], { cwd: dir, env: { ...process.env, HOME: dir, CI: '1' } });

const pkg = scripts => JSON.stringify({ name: 'x', version: '1.0.0', scripts }, null, 2) + '\n';

test('failed bump keeps uncommitted edits to version files', () => {
  const r = repo({ 'package.json': pkg({ version: 'echo boom && exit 1' }) });
  writeFileSync(join(r.dir, 'package.json'), r.read('package.json').replace('"scripts"', '"private": true,\n  "scripts"'));
  const before = r.read('package.json');
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.equal(r.read('package.json'), before);
  assert.equal(r.sh('git tag'), '');
});

test('failed bump restores untracked version files too', () => {
  const r = repo({ 'package.json': pkg({ version: 'echo boom && exit 1' }), '.gitignore': 'gen.h\n' });
  writeFileSync(join(r.dir, '.bump.json'), JSON.stringify({ files: [{ path: 'gen.h', pattern: 'V "([^"]+)"' }] }));
  writeFileSync(join(r.dir, 'gen.h'), '#define V "1.0.0"\n');
  r.sh('git add .bump.json && git commit -qm cfg');
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
  assert.equal(r.read('gen.h'), '#define V "1.0.0"\n');
});

test('rollback after commit keeps edits that were folded into the bump commit', () => {
  const r = repo({ 'package.json': pkg({ postversion: 'echo boom && exit 1' }), 'notes.txt': 'old\n' });
  const base = r.sh('git rev-parse HEAD');
  writeFileSync(join(r.dir, 'notes.txt'), 'work in progress\n');
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.equal(r.read('notes.txt'), 'work in progress\n');
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
  assert.equal(r.sh('git rev-parse HEAD'), base);
  assert.equal(r.sh('git tag'), '');
});

test('rollback undoes commits made by npm scripts without losing their content', () => {
  const r = repo({ 'package.json': pkg({ postversion: 'echo log > CHANGELOG && git add CHANGELOG && git commit -qm log && exit 1' }) });
  const base = r.sh('git rev-parse HEAD');
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.equal(r.sh('git rev-parse HEAD'), base);
  assert.equal(r.read('CHANGELOG'), 'log\n');
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
});

test('silent failing pre-commit hook fails the bump, no tag', () => {
  const r = repo({ 'package.json': pkg({}) });
  writeFileSync(join(r.dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(r.dir, '.git/hooks/pre-commit'), 0o755);
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.equal(r.sh('git tag'), '');
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
});
