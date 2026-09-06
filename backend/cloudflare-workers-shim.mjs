// 模拟 `cloudflare:workers` 的 `env` 导出：字符串配置来自 process.env，
// `DB` 绑定则由 node:sqlite 实现的 D1 shim 提供。
import { openD1 } from './d1-shim.mjs';

export const env = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'DB') return openD1();
      const value = process.env[String(key)];
      return value ?? '';
    },
  },
);
