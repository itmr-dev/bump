import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
function find(a, text, keep = () => true) {
    const flags = a.pattern.flags.replace('g', '').replace('d', '');
    const found = [...text.matchAll(new RegExp(a.pattern.source, flags + 'gd'))].filter(keep);
    if (found.length > 1)
        throw new Error(`${a.file}: version found ${found.length} times, expected once`);
    if (found.length === 0 && a.strict)
        throw new Error(`${a.file}: no version matching ${a.pattern}`);
    return found[0];
}
function replaceSpan(text, m, value) {
    const [start, end] = m.indices[1];
    return text.slice(0, start) + value + text.slice(end);
}
// nesting depth of {/[ at index, ignoring brackets inside strings
function jsonDepth(text, index) {
    let depth = 0;
    let inString = false;
    for (let i = 0; i < index; i++) {
        const c = text[i];
        if (inString) {
            if (c === '\\')
                i++;
            else if (c === '"')
                inString = false;
        }
        else if (c === '"')
            inString = true;
        else if (c === '{' || c === '[')
            depth++;
        else if (c === '}' || c === ']')
            depth--;
    }
    return depth;
}
// "version" key at a given object depth, cross-checked against a real parse
function jsonAdapter(name, file, depth, get) {
    const a = {
        name,
        file,
        pattern: /"version"\s*:\s*"([^"]*)"/,
        read(text) {
            const m = find(a, text, m => jsonDepth(text, m.index) === depth);
            if (!m)
                return null;
            if (get(JSON.parse(text)) !== m[1])
                throw new Error(`${file}: could not locate "version" safely`);
            return m[1];
        },
        write: (text, version) => replaceSpan(text, find(a, text, m => jsonDepth(text, m.index) === depth), version),
    };
    return a;
}
// `version = "x"` inside a TOML [section]; stops at the next line starting with [
function tomlPattern(sections) {
    return new RegExp(String.raw `^\[(?:${sections})\][^\S\n]*\r?\n(?:(?!\[)[^\n]*\n)*?[^\S\n]*version\s*=\s*"([^"]+)"`, 'm');
}
function patternAdapter(name, file, pattern, extra = {}) {
    return Object.assign({ name, file, pattern }, extra);
}
const python = patternAdapter('python', 'pyproject.toml', tomlPattern(String.raw `project|tool\.poetry`));
const flutter = patternAdapter('flutter', 'pubspec.yaml', /^version:\s*["']?([^"'\s#]+)/m);
export const builtins = [
    jsonAdapter('npm', 'package.json', 1, o => o.version),
    {
        name: 'npm-lock',
        file: 'package-lock.json',
        follows: 'npm',
        read: text => { var _a; return (_a = JSON.parse(text).version) !== null && _a !== void 0 ? _a : null; },
        write(text, version) {
            var _a;
            const lock = JSON.parse(text);
            lock.version = version;
            if ((_a = lock.packages) === null || _a === void 0 ? void 0 : _a[''])
                lock.packages[''].version = version;
            return JSON.stringify(lock, null, 2) + '\n';
        },
    },
    jsonAdapter('expo', 'app.json', 2, o => { var _a; return (_a = o.expo) === null || _a === void 0 ? void 0 : _a.version; }),
    jsonAdapter('platformio-lib', 'library.json', 1, o => o.version),
    patternAdapter('arduino-lib', 'library.properties', /^version=(.+)$/m),
    patternAdapter('cargo', 'Cargo.toml', tomlPattern(String.raw `package|workspace\.package`)),
    Object.assign(Object.assign({}, python), { read(text) {
            var _a, _b;
            if (/^\[project\][^\n]*\n(?:(?!\[)[^\n]*\n)*?\s*dynamic\s*=\s*\[[^\]]*["']version["']/m.test(text))
                return null;
            return (_b = (_a = find(python, text)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : null;
        } }),
    Object.assign(Object.assign({}, flutter), { write(text, version) {
            const m = find(flutter, text);
            const build = m[1].match(/\+(\d+)$/);
            return replaceSpan(text, m, build ? `${version}+${Number(build[1]) + 1}` : version);
        } }),
    patternAdapter('helm', 'Chart.yaml', /^version:\s*["']?([^"'\s#]+)/m),
];
export function readVersion(a, text) {
    var _a, _b;
    return a.read ? a.read(text) : (_b = (_a = find(a, text)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : null;
}
export function writeVersion(a, text, version) {
    if (a.write)
        return a.write(text, version);
    const m = find(a, text);
    if (!m)
        throw new Error(`${a.file}: no version to replace`);
    return replaceSpan(text, m, version);
}
export function loadRepoAdapters(cwd) {
    var _a;
    const path = join(cwd, '.bump.json');
    if (!existsSync(path))
        return [];
    try {
        const config = JSON.parse(readFileSync(path, 'utf8'));
        return ((_a = config.files) !== null && _a !== void 0 ? _a : []).map((f) => {
            const pattern = new RegExp(f.pattern, 'm');
            // an always-matching alternative reveals the group count
            if (new RegExp(`${f.pattern}|`).exec('').length < 2)
                throw new Error(`pattern for ${f.path} needs one capture group`);
            return { name: f.path, file: f.path, pattern, strict: true };
        });
    }
    catch (error) {
        throw new Error(`.bump.json: ${error.message}`);
    }
}
export function detect(cwd) {
    const found = [];
    for (const adapter of [...builtins, ...loadRepoAdapters(cwd)]) {
        const path = join(cwd, adapter.file);
        if (!existsSync(path))
            continue;
        const current = readVersion(adapter, readFileSync(path, 'utf8'));
        if (current !== null)
            found.push({ adapter, path, current });
    }
    return found.filter(f => !f.adapter.follows || found.some(o => o.adapter.name === f.adapter.follows));
}
//# sourceMappingURL=adapters.js.map