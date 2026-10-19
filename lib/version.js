import semver from 'semver';
/** Normalised semver without leading `v` or `+build`, or null. `x` and `x.y` are padded. */
export function parseVersion(raw) {
    const v = raw.trim().replace(/^v/, '').replace(/\+.*$/, '');
    if (semver.valid(v))
        return v;
    if (/^\d+(\.\d+)?$/.test(v))
        return semver.coerce(v).version;
    return null;
}
export function nextVersion(current, type, preid) {
    const parsed = parseVersion(current);
    const next = parsed && semver.inc(parsed, type, {}, preid || undefined);
    if (!next)
        throw new Error(`Cannot bump '${current}': not a valid version`);
    return next;
}
/** Highest real semver tag (no padding of `7`-style tags), null if none. */
export function highestTag(tags) {
    const versions = tags.map(t => t.replace(/^v/, '')).filter(t => semver.valid(t));
    return versions.length ? semver.rsort(versions)[0] : null;
}
/** Update check: is `latest` (from npm) newer than the running `current`? Prerelease-aware. */
export function isNewer(latest, current) {
    return semver.gt(latest, current);
}
//# sourceMappingURL=version.js.map