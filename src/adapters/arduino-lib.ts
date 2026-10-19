import { Adapter } from './core.js';

const arduinoLib: Adapter = { name: 'arduino-lib', file: 'library.properties', pattern: /^version=(.+)$/m };

export default arduinoLib;
