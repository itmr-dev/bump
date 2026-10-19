import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { builtins, readVersion, writeVersion, loadRepoAdapters, detect } from '../lib/adapters/index.js';

const by = name => builtins.find(a => a.name === name);

// read the fixture, write 9.9.9, expect only the version text to change
function roundtrip(name, text, from, to = '9.9.9', expected = text.replace(from, to)) {
  const a = by(name);
  assert.equal(readVersion(a, text), from);
  assert.equal(writeVersion(a, text, to), expected);
}

function tmp(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bump-'));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return dir;
}

test('npm', () => roundtrip('npm', '{\n  "name": "x",\n  "version": "1.2.3",\n  "dependencies": { "a": "1.2.3" }\n}\n', '1.2.3'));

test('package.json: nested version before top-level', () => {
  const t = '{\n  "engines": { "version": "0.1.0" },\n  "version": "1.2.3"\n}\n';
  assert.equal(readVersion(by('npm'), t), '1.2.3');
  assert.equal(writeVersion(by('npm'), t, '1.2.4'), t.replace('"1.2.3"', '"1.2.4"'));
});

test('npm-lock rewrites both version fields', () => {
  const t = JSON.stringify({ name: 'x', version: '1.2.3', lockfileVersion: 3, packages: { '': { name: 'x', version: '1.2.3' } } }, null, 2) + '\n';
  assert.equal(readVersion(by('npm-lock'), t), '1.2.3');
  assert.equal(writeVersion(by('npm-lock'), t, '1.2.4'), t.replaceAll('1.2.3', '1.2.4'));
});

test('expo', () => roundtrip('expo', '{\n  "expo": {\n    "name": "x",\n    "version": "1.0.0",\n    "ios": { "buildNumber": "1.0.0" }\n  }\n}\n', '1.0.0'));
test('platformio-lib', () => roundtrip('platformio-lib', '{\n  "name": "Lib",\n  "version": "0.4.1"\n}\n', '0.4.1'));
test('arduino-lib', () => roundtrip('arduino-lib', 'name=Lib\nversion=1.0\nauthor=me\n', '1.0'));

test('CRLF preserved', () => {
  const t = 'name=Lib\r\nversion=1.0.0\r\nauthor=me\r\n';
  assert.equal(readVersion(by('arduino-lib'), t), '1.0.0');
  assert.equal(writeVersion(by('arduino-lib'), t, '1.0.1'), 'name=Lib\r\nversion=1.0.1\r\nauthor=me\r\n');
});

test('cargo', () => roundtrip('cargo', '[package]\nname = "x"\nkeywords = ["a", "b"]\nversion = "0.3.0"\n\n[dependencies]\nserde = "1"\n', '0.3.0'));
test('cargo workspace.package', () => roundtrip('cargo', '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "2.0.0"\n', '2.0.0'));

test('cargo ignores dependency tables', () => {
  const t = '[dependencies.foo]\nversion = "0.1"\n\n[package]\nname = "x"\nversion = "1.2.3"\n\n[dependencies.bar]\nversion = "0.2"\n';
  roundtrip('cargo', t, '1.2.3');
});

test('cargo virtual workspace / member with version.workspace is skipped', () => {
  assert.equal(readVersion(by('cargo'), '[workspace]\nmembers = ["a"]\n'), null);
  assert.equal(readVersion(by('cargo'), '[package]\nname = "a"\nversion.workspace = true\n'), null);
});

test('cargo: indented sub-table ends the [package] section', () => {
  assert.equal(readVersion(by('cargo'), '[package]\nname = "x"\n  [package.metadata.x]\n  version = "0.1"\n'), null);
});

test('cargo: comment after the section header', () => roundtrip('cargo', '[package] # main crate\nname = "x"\nversion = "0.3.0"\n', '0.3.0'));

test('.bump.json entry with a missing file aborts', () => {
  const dir = tmp({ '.bump.json': JSON.stringify({ files: [{ path: 'platformio.inii', pattern: 'v=(\\S+)' }] }) });
  assert.throws(() => detect(dir), /\.bump\.json.*platformio\.inii/);
});

test('python [project] and [tool.poetry]', () => {
  roundtrip('python', '[project]\nname = "x"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 100\n', '0.1.0');
  roundtrip('python', '[tool.poetry]\nname = "x"\nversion = "0.1.0"\n', '0.1.0');
});

test('python dynamic version is skipped', () => {
  assert.equal(readVersion(by('python'), '[project]\nname = "x"\ndynamic = ["version"]\n'), null);
  assert.equal(readVersion(by('python'), '[tool.ruff]\nline-length = 100\n'), null);
});

test('flutter +N increments, absent stays absent', () => {
  assert.equal(readVersion(by('flutter'), 'name: app\nversion: 1.2.3+7\n'), '1.2.3+7');
  assert.equal(writeVersion(by('flutter'), 'version: 1.2.3+7\n', '1.2.4'), 'version: 1.2.4+8\n');
  assert.equal(writeVersion(by('flutter'), 'version: 1.2.3\n', '1.2.4'), 'version: 1.2.4\n');
});

test('helm leaves appVersion alone', () => roundtrip('helm', 'apiVersion: v2\nname: x\nversion: 1.2.3\nappVersion: "1.2.3"\n', '1.2.3'));

test('two matches throws', () => {
  assert.throws(() => readVersion(by('arduino-lib'), 'version=1.0.0\nversion=1.0.1\n'), /library\.properties/);
});

test('strict zero matches throws, builtin zero matches is null', () => {
  assert.equal(readVersion(by('arduino-lib'), 'name=Lib\n'), null);
  const [custom] = loadRepoAdapters(tmp({ '.bump.json': JSON.stringify({ files: [{ path: 'platformio.ini', pattern: 'custom_version\\s*=\\s*(\\S+)' }] }) }));
  assert.throws(() => readVersion(custom, '[env:esp32]\nboard = x\n'), /platformio\.ini/);
});

test('.bump.json custom file roundtrip', () => {
  const [custom] = loadRepoAdapters(tmp({ '.bump.json': JSON.stringify({ files: [{ path: 'platformio.ini', pattern: 'custom_version\\s*=\\s*(\\S+)' }] }) }));
  const t = '[env:esp32]\nboard = x\ncustom_version = 1.4.0\n';
  assert.equal(readVersion(custom, t), '1.4.0');
  assert.equal(writeVersion(custom, t, '1.4.1'), t.replace('1.4.0', '1.4.1'));
});

test('.bump.json bad JSON / bad regex / no capture group throw mentioning .bump.json', () => {
  assert.deepEqual(loadRepoAdapters(tmp({})), []);
  assert.throws(() => loadRepoAdapters(tmp({ '.bump.json': '{ nope' })), /\.bump\.json/);
  assert.throws(() => loadRepoAdapters(tmp({ '.bump.json': '{"files":[{"path":"a","pattern":"("}]}' })), /\.bump\.json/);
  assert.throws(() => loadRepoAdapters(tmp({ '.bump.json': '{"files":[{"path":"a","pattern":"v=\\\\S+"}]}' })), /\.bump\.json/);
});

test('detect finds matching files and skips empty ones', () => {
  const dir = tmp({
    'package.json': '{ "name": "x", "version": "1.0.0" }\n',
    'package-lock.json': '{ "name": "x", "version": "1.0.0", "packages": { "": { "version": "1.0.0" } } }\n',
    'pyproject.toml': '[tool.ruff]\nline-length = 100\n',
  });
  assert.deepEqual(detect(dir).map(f => [f.adapter.name, f.current]), [['npm', '1.0.0'], ['npm-lock', '1.0.0']]);
});

test('detect skips npm-lock without package.json', () => {
  assert.deepEqual(detect(tmp({ 'package-lock.json': '{ "version": "1.0.0" }\n' })), []);
});
