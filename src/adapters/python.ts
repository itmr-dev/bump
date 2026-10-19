import { Adapter, find, tomlPattern } from './core.js';

const python: Adapter = {
  name: 'python',
  file: 'pyproject.toml',
  pattern: tomlPattern(String.raw`project|tool\.poetry`),
  read(text) {
    // dynamic versions (hatch-vcs, setuptools-scm) come from git, nothing to write
    if (/^\[project\][^\n]*\n(?:(?!\[)[^\n]*\n)*?\s*dynamic\s*=\s*\[[^\]]*["']version["']/m.test(text)) return null;
    return find(python, text)?.[1] ?? null;
  },
};

export default python;
