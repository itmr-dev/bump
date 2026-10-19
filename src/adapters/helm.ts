import { Adapter } from './core.js';

// column-0 `version:` only, never appVersion
const helm: Adapter = { name: 'helm', file: 'Chart.yaml', pattern: /^version:\s*["']?([^"'\s#]+)/m };

export default helm;
