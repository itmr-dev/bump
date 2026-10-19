#!/usr/bin/env node

// Entry point: checks the Node version before any dependency is loaded,
// because on an unsupported Node they may fail to even import.
import { readFileSync } from 'fs';
import { supportsNode } from './version.js';

// last release that still runs on Node 18 / 20
const LAST_LEGACY_VERSION = '2.0.1';

const { version, engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!supportsNode(engines?.node, process.versions.node)) {
  console.error(`ⓧ bump ${version} needs Node.js ${engines.node}, but this is Node.js ${process.versions.node}.`);
  console.error(`  Update Node.js, or install the last version that runs on it: npm install -g @itmr.dev/bump@${LAST_LEGACY_VERSION}`);
  process.exit(1);
}

await import('./index.js');
