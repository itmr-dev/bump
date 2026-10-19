import { find, replaceSpan } from './core.js';
const flutter = {
    name: 'flutter',
    file: 'pubspec.yaml',
    pattern: /^version:\s*["']?([^"'\s#]+)/m,
    write(text, version) {
        // 1.2.3+7 -> 1.2.4+8, the build number only when there is one
        const m = find(flutter, text);
        const build = m[1].match(/\+(\d+)$/);
        return replaceSpan(text, m, build ? `${version}+${Number(build[1]) + 1}` : version);
    },
};
export default flutter;
//# sourceMappingURL=flutter.js.map