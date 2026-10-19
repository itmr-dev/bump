import { jsonAdapter } from './core.js';

export default jsonAdapter('platformio-lib', 'library.json', 1, o => o.version);
