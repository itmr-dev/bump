import { jsonAdapter } from './core.js';

export default jsonAdapter('expo', 'app.json', 2, o => o.expo?.version);
