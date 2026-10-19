import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const bin = fileURLToPath(new URL('../lib/cli.js', import.meta.url));

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

test('Ctrl+C during the bump rolls back', async () => {
  const r = repo({ 'package.json': pkg({ version: 'sleep 5' }) });
  const child = spawn('node', [bin, '-y', '--force-branch', '--no-push', 'patch'], { cwd: r.dir, env: { ...process.env, HOME: r.dir, CI: '1' } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  // wait until bump is inside the version script, then interrupt it
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const t = setInterval(() => {
      if (r.read('package.json').includes('1.0.1')) { clearInterval(t); resolve(); }
      else if (Date.now() > deadline) { clearInterval(t); child.kill(); reject(new Error(`bump never reached the version script: ${out}`)); }
    }, 50);
  });
  child.kill('SIGINT');
  await new Promise(resolve => child.on('exit', resolve));
  assert.match(out, /Changes reverted/);
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
  assert.equal(r.sh('git tag'), '');
});

test('silent failing pre-commit hook fails the bump, no tag', () => {
  const r = repo({ 'package.json': pkg({}) });
  writeFileSync(join(r.dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(r.dir, '.git/hooks/pre-commit'), 0o755);
  assert.equal(bump(r.dir, 'patch').status, 1);
  assert.equal(r.sh('git tag'), '');
  assert.match(r.read('package.json'), /"version": "1\.0\.0"/);
});

test('upgrade notice: shown once to v1 and 2.0.x users, never to new users', () => {
  const r = repo({ 'package.json': pkg({}) });
  const run = home => spawnSync('node', [bin, '-y', '--force-branch', '--no-push', 'patch'], { cwd: r.dir, env: { ...process.env, HOME: home, CI: '1' } }).stdout.toString();
  const rc = home => JSON.parse(readFileSync(join(home, '.bumprc'), 'utf8'));

  // v1 wrote .bumprc without lastVersion
  const v1Home = mkdtempSync(join(tmpdir(), 'bump-home-'));
  writeFileSync(join(v1Home, '.bumprc'), JSON.stringify({ updates: { check: true, autoUpdate: false }, branches: { allowed: ['main'] } }));
  assert.match(run(v1Home), /CHANGELOG\.md/);
  assert.equal(rc(v1Home).updates.autoUpdate, false, 'user settings are kept');
  assert.ok(rc(v1Home).lastVersion);
  assert.doesNotMatch(run(v1Home), /CHANGELOG\.md/);

  // 2.1.0 is announced to users coming from 2.0.x, once
  const v2Home = mkdtempSync(join(tmpdir(), 'bump-home-'));
  writeFileSync(join(v2Home, '.bumprc'), JSON.stringify({ lastVersion: '2.0.1', updates: { check: false, autoUpdate: false }, branches: { allowed: ['main'] } }));
  assert.match(run(v2Home), /CHANGELOG\.md/);
  assert.doesNotMatch(run(v2Home), /CHANGELOG\.md/);

  const newHome = mkdtempSync(join(tmpdir(), 'bump-home-'));
  assert.doesNotMatch(run(newHome), /CHANGELOG\.md/);
  assert.doesNotMatch(run(newHome), /CHANGELOG\.md/);
});

test('unsupported Node: clear message before loading anything', () => {
  // pretend to be Node 20 before bump starts
  const fake = 'data:text/javascript,Object.defineProperty(process, "versions", { value: { ...process.versions, node: "20.11.0" } })';
  const r = spawnSync('node', ['--import', fake, bin, '--help'], { env: { ...process.env, CI: '1' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr.toString(), /Node\.js .*20\.11\.0/);
  assert.match(r.stderr.toString(), /@itmr\.dev\/bump@2\.0\.1/);
  assert.doesNotMatch(r.stdout.toString(), /Usage/);
});
