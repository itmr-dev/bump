import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, nextVersion, highestTag, isNewer } from '../lib/version.js';

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

test('isNewer handles prereleases for the update check', () => {
  assert.equal(isNewer('1.6.0', '1.6.0-beta.0'), true);
  assert.equal(isNewer('1.10.0', '1.9.0'), true);
  assert.equal(isNewer('1.5.0', '1.5.0'), false);
  assert.equal(isNewer('1.5.0', '1.6.0-beta.0'), false);
});
