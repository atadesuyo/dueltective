// 纯后端打包入口：复用真实游戏逻辑，仅把 `cloudflare:workers` 别名到 Node shim。
export { getRoom, createRoom, act } from '../lib/server/game';
export { aiReady } from '../lib/server/ai';
export { newSession } from '../lib/server/storage';
