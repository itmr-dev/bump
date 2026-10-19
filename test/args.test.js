import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/args.js';

test('flags anywhere, positionals keep their order', () => {
  const c = parseArgs(['--force-branch', 'patch', 'my message', '-v']);
  assert.equal(c.bumpType, 'patch');
  assert.equal(c.commitMessage, 'my message');
  assert.equal(c.forceBranch, true);
  assert.equal(c.verbose, true);
});

test('--preid in both forms, value is not a positional', () => {
  assert.equal(parseArgs(['--preid', 'beta', 'prerelease']).preId, 'beta');
  assert.equal(parseArgs(['--preid', 'beta', 'prerelease']).bumpType, 'prerelease');
  assert.equal(parseArgs(['prerelease', '--preid=rc']).preId, 'rc');
});

test('push is tri-state', () => {
  assert.equal(parseArgs(['patch']).push, undefined);
  assert.equal(parseArgs(['patch', '--push']).push, true);
  assert.equal(parseArgs(['patch', '--no-push']).push, false);
});

test('non-interactive via flag or environment', () => {
  assert.equal(parseArgs(['patch']).nonInteractive, false);
  assert.equal(parseArgs(['patch', '-y']).nonInteractive, true);
  assert.equal(parseArgs(['patch'], false).nonInteractive, true);
});

test('unknown flags are collected, not treated as the bump type', () => {
  const c = parseArgs(['--nope', 'patch']);
  assert.deepEqual(c.unknown, ['--nope']);
  assert.equal(c.bumpType, 'patch');
});
