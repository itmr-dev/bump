// column-0 `version:` only, never appVersion
const helm = { name: 'helm', file: 'Chart.yaml', pattern: /^version:\s*["']?([^"'\s#]+)/m };
export default helm;
//# sourceMappingURL=helm.js.map