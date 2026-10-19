// rewritten the way npm writes it; follows package.json and is not part of the consistency check
const npmLock = {
    name: 'npm-lock',
    file: 'package-lock.json',
    follows: 'npm',
    read: text => JSON.parse(text).version ?? null,
    write(text, version) {
        const lock = JSON.parse(text);
        lock.version = version;
        if (lock.packages?.[''])
            lock.packages[''].version = version;
        return JSON.stringify(lock, null, 2) + '\n';
    },
};
export default npmLock;
//# sourceMappingURL=npm-lock.js.map