import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface Adapter {
  name: string;
  file: string;
  /** exactly one capture group = the version */
  pattern?: RegExp;
  read?(text: string): string | null;
  write?(text: string, version: string): string;
  /** .bump.json entries: zero matches is an error, not "not this kind of project" */
  strict?: boolean;
  /** only used when the named adapter matched, and left out of the consistency check */
  follows?: string;
}

export interface VersionFile { adapter: Adapter; path: string; current: string }

function find(a: Adapter, text: string, keep: (m: RegExpMatchArray) => boolean = () => true) {
  const flags = a.pattern!.flags.replace('g', '').replace('d', '');
  const found = [...text.matchAll(new RegExp(a.pattern!.source, flags + 'gd'))].filter(keep);
  if (found.length > 1) throw new Error(`${a.file}: version found ${found.length} times, expected once`);
  if (found.length === 0 && a.strict) throw new Error(`${a.file}: no version matching ${a.pattern}`);
  return found[0] as RegExpMatchArray | undefined;
}

function replaceSpan(text: string, m: RegExpMatchArray, value: string) {
  const [start, end] = m.indices![1];
  return text.slice(0, start) + value + text.slice(end);
}

// nesting depth of {/[ at index, ignoring brackets inside strings
function jsonDepth(text: string, index: number) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < index; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth;
}

// "version" key at a given object depth, cross-checked against a real parse
function jsonAdapter(name: string, file: string, depth: number, get: (o: any) => unknown): Adapter {
  const a: Adapter = {
    name,
    file,
    pattern: /"version"\s*:\s*"([^"]*)"/,
    read(text) {
      const m = find(a, text, m => jsonDepth(text, m.index!) === depth);
      if (!m) return null;
      if (get(JSON.parse(text)) !== m[1]) throw new Error(`${file}: could not locate "version" safely`);
      return m[1];
    },
    write: (text, version) => replaceSpan(text, find(a, text, m => jsonDepth(text, m.index!) === depth)!, version),
  };
  return a;
}

// `version = "x"` inside a TOML [section]; stops at the next (possibly indented) [header]
function tomlPattern(sections: string) {
  return new RegExp(String.raw`^\[(?:${sections})\][^\S\n]*(?:#[^\n]*)?\r?\n(?:(?![^\S\n]*\[)[^\n]*\n)*?[^\S\n]*version\s*=\s*"([^"]+)"`, 'm');
}

function patternAdapter(name: string, file: string, pattern: RegExp, extra: Partial<Adapter> = {}): Adapter {
  return { name, file, pattern, ...extra };
}

const python = patternAdapter('python', 'pyproject.toml', tomlPattern(String.raw`project|tool\.poetry`));
const flutter = patternAdapter('flutter', 'pubspec.yaml', /^version:\s*["']?([^"'\s#]+)/m);

export const builtins: Adapter[] = [
  jsonAdapter('npm', 'package.json', 1, o => o.version),
  {
    name: 'npm-lock',
    file: 'package-lock.json',
    follows: 'npm',
    read: text => JSON.parse(text).version ?? null,
    write(text, version) {
      const lock = JSON.parse(text);
      lock.version = version;
      if (lock.packages?.['']) lock.packages[''].version = version;
      return JSON.stringify(lock, null, 2) + '\n';
    },
  },
  jsonAdapter('expo', 'app.json', 2, o => o.expo?.version),
  jsonAdapter('platformio-lib', 'library.json', 1, o => o.version),
  patternAdapter('arduino-lib', 'library.properties', /^version=(.+)$/m),
  patternAdapter('cargo', 'Cargo.toml', tomlPattern(String.raw`package|workspace\.package`)),
  {
    ...python,
    read(text) {
      if (/^\[project\][^\n]*\n(?:(?!\[)[^\n]*\n)*?\s*dynamic\s*=\s*\[[^\]]*["']version["']/m.test(text)) return null;
      return find(python, text)?.[1] ?? null;
    },
  },
  {
    ...flutter,
    write(text, version) {
      const m = find(flutter, text)!;
      const build = m[1].match(/\+(\d+)$/);
      return replaceSpan(text, m, build ? `${version}+${Number(build[1]) + 1}` : version);
    },
  },
  patternAdapter('helm', 'Chart.yaml', /^version:\s*["']?([^"'\s#]+)/m),
];

export function readVersion(a: Adapter, text: string): string | null {
  return a.read ? a.read(text) : find(a, text)?.[1] ?? null;
}

export function writeVersion(a: Adapter, text: string, version: string): string {
  if (a.write) return a.write(text, version);
  const m = find(a, text);
  if (!m) throw new Error(`${a.file}: no version to replace`);
  return replaceSpan(text, m, version);
}

export function loadRepoAdapters(cwd: string): Adapter[] {
  const path = join(cwd, '.bump.json');
  if (!existsSync(path)) return [];
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    return (config.files ?? []).map((f: { path: string; pattern: string }) => {
      const pattern = new RegExp(f.pattern, 'm');
      // an always-matching alternative reveals the group count
      if (new RegExp(`${f.pattern}|`).exec('')!.length < 2) throw new Error(`pattern for ${f.path} needs one capture group`);
      return { name: f.path, file: f.path, pattern, strict: true };
    });
  } catch (error) {
    throw new Error(`.bump.json: ${(error as Error).message}`);
  }
}

export function detect(cwd: string): VersionFile[] {
  const found: VersionFile[] = [];
  for (const adapter of [...builtins, ...loadRepoAdapters(cwd)]) {
    const path = join(cwd, adapter.file);
    if (!existsSync(path)) {
      if (adapter.strict) throw new Error(`.bump.json: ${adapter.file} not found`);
      continue;
    }
    const current = readVersion(adapter, readFileSync(path, 'utf8'));
    if (current !== null) found.push({ adapter, path, current });
  }
  return found.filter(f => !f.adapter.follows || found.some(o => o.adapter.name === f.adapter.follows));
}
