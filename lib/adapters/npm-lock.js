// rewritten the way npm writes it; follows package.json and is not part of the consistency check
const npmLock = {
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
};
export default npmLock;
//# sourceMappingURL=npm-lock.js.map