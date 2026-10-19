// shared building blocks for adapters; one adapter per file next to this one
export function find(a, text, keep = () => true) {
    const flags = a.pattern.flags.replace('g', '').replace('d', '');
    const found = [...text.matchAll(new RegExp(a.pattern.source, flags + 'gd'))].filter(keep);
    if (found.length > 1)
        throw new Error(`${a.file}: version found ${found.length} times, expected once`);
    if (found.length === 0 && a.strict)
        throw new Error(`${a.file}: no version matching ${a.pattern}`);
    return found[0];
}
export function replaceSpan(text, m, value) {
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
export function jsonAdapter(name, file, depth, get) {
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
// `version = "x"` inside a TOML [section]; stops at the next (possibly indented) [header]
export function tomlPattern(sections) {
    return new RegExp(String.raw `^\[(?:${sections})\][^\S\n]*(?:#[^\n]*)?\r?\n(?:(?![^\S\n]*\[)[^\n]*\n)*?[^\S\n]*version\s*=\s*"([^"]+)"`, 'm');
}
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
//# sourceMappingURL=core.js.map