import { find, tomlPattern } from './core.js';
const python = {
    name: 'python',
    file: 'pyproject.toml',
    pattern: tomlPattern(String.raw `project|tool\.poetry`),
    read(text) {
        var _a, _b;
        // dynamic versions (hatch-vcs, setuptools-scm) come from git, nothing to write
        if (/^\[project\][^\n]*\n(?:(?!\[)[^\n]*\n)*?\s*dynamic\s*=\s*\[[^\]]*["']version["']/m.test(text))
            return null;
        return (_b = (_a = find(python, text)) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : null;
    },
};
export default python;
//# sourceMappingURL=python.js.map