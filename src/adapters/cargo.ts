import { Adapter, tomlPattern } from './core.js';

const cargo: Adapter = { name: 'cargo', file: 'Cargo.toml', pattern: tomlPattern(String.raw`package|workspace\.package`) };

export default cargo;
