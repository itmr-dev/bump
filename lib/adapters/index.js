import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readVersion } from './core.js';
import npm from './npm.js';
import npmLock from './npm-lock.js';
import expo from './expo.js';
import platformioLib from './platformio-lib.js';
import arduinoLib from './arduino-lib.js';
import cargo from './cargo.js';
import python from './python.js';
import flutter from './flutter.js';
import helm from './helm.js';
export { readVersion, writeVersion } from './core.js';
// detection and display order; new adapters get registered here
export const builtins = [npm, npmLock, expo, platformioLib, arduinoLib, cargo, python, flutter, helm];
export function loadRepoAdapters(cwd) {
    const path = join(cwd, '.bump.json');
    if (!existsSync(path))
        return [];
    try {
        const config = JSON.parse(readFileSync(path, 'utf8'));
        return (config.files ?? []).map((f) => {
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
        if (!existsSync(path)) {
            if (adapter.strict)
                throw new Error(`.bump.json: ${adapter.file} not found`);
            continue;
        }
        const current = readVersion(adapter, readFileSync(path, 'utf8'));
        if (current !== null)
            found.push({ adapter, path, current });
    }
    return found.filter(f => !f.adapter.follows || found.some(o => o.adapter.name === f.adapter.follows));
}
//# sourceMappingURL=index.js.map