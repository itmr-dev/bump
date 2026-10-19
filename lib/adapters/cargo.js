import { tomlPattern } from './core.js';
const cargo = { name: 'cargo', file: 'Cargo.toml', pattern: tomlPattern(String.raw `package|workspace\.package`) };
export default cargo;
//# sourceMappingURL=cargo.js.map