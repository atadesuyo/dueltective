# Dueltective

A two-player, server-authoritative deduction game. React + Vinext, Cloudflare Workers and D1, hosted with Sites. No player accounts are required. Room membership uses an HttpOnly SameSite session cookie; the database stores only its SHA-256 hash.

## Rules

Each round begins with a rules briefing. Both players must confirm before the first 25-second ASK phase starts. The active player asks one question, then receives an exclusive 15-second answer / pass phase. ASK timeout skips the turn; decision timeout passes automatically. The server owns both deadlines.

DeepSeek answers only `YES`, `NO`, or `UNKNOWN`. Subjective, ambiguous, unsupported, or unreliable questions resolve to `UNKNOWN` and still consume the ASK.

Each player receives two single-use abilities per round:

- **Private Question**: only the asker receives the question and answer.
- **Private Answer**: both players receive the question; only the asker receives the answer.

Each player starts with three answer lives. Every answer consumes one life. A correct answer wins immediately; reaching zero lives loses immediately. Rematches reset lives and abilities, randomize two distinct detective avatars, and alternate the first player. Win/loss records persist for the life of the room.

Room creators choose from the current Overwatch hero roster, 31 Street Fighter 6 characters, or the original 151 Pokémon. With `DEEPSEEK_API_KEY`, DeepSeek selects the secret and judges freeform questions. The server-only fallback provides a compact sample from every category.

Each room remembers its last two secrets, so a character cannot return during the next two rounds.

## Local development

Use Node 22.13+ and the committed lockfile.

```sh
npm ci
npm run dev
node scripts/local-db.mjs
```

Use two devices, two browsers, or a regular and incognito window for separate player identities. Refresh restores the session. Rooms expire after 24 hours without a successful state change.

## AI and deployment

Keep `DEEPSEEK_API_KEY` in an ignored local env file and a Sites runtime secret. The default model is `deepseek-v4-flash`; `DEEPSEEK_MODEL` can override it. Calls use Chat Completions JSON mode with server-side schema validation and one retry for empty or malformed JSON.

`AI_DAILY_LIMIT` defaults to 500 AI calls per UTC day. Player actions have additional server-side frequency limits. Configure balance controls in the DeepSeek platform before wider release.

## Synchronization and privacy

Clients poll the authenticated room endpoint every 800 ms. Every mutation includes an expected revision and uses a conditional D1 update, so concurrent or replayed actions cannot apply twice. AI calls acquire a persisted operation lease.

The response DTO is projected separately for each player. Private Question events are omitted from the opponent's response. Private Answer events retain the public question and remove the answer for the opponent. Secret names, aliases, facts, and session hashes remain server-side until settlement.

## Validation

Two independent sessions cover room membership, mandatory ASK-before-GUESS, public answer sync, Private Question isolation, Private Answer redaction, UNKNOWN turn consumption, both automatic timeout transitions, three-life loss, rematch resets, and alternating first player. TypeScript and production builds are checked. A live DeepSeek request previously verified credential, model, JSON generation, and answer judging.

## 纯后端与自动化自测

不依赖前端框架即可在本地运行真实游戏逻辑并自动对局：

```sh
npm run backend      # 纯后端 HTTP 服务（默认 http://localhost:8787）
npm run selftest     # 打包真实逻辑并自动模拟两位玩家完整对局、断言规则
```

角色知识库位于 `lib/server/knowledge.ts`（守望先锋 + 街头霸王 6），可运行 `node scripts/fetch-wiki.mjs` 从 fandom wiki 抓取并合并词条。API 地址可通过 `DEEPSEEK_API_BASE` 覆盖。

## 无需 OpenAI Sites 的部署（Cloudflare Workers + D1）

不依赖 ChatGPT / OpenAI Sites，直接部署到你自己的 Cloudflare 账号：

```sh
# 一次性准备
npm ci
npx wrangler login                        # 登录 Cloudflare
npx wrangler d1 create dueltective-db     # 创建 D1，记下返回的 database_id

# 一键构建 + 建表 + 部署
CLOUDFLARE_D1_DATABASE_ID=你的database_id npm run deploy:cloudflare

# 可选：设置 DeepSeek 密钥以启用 AI 出题/裁判
npx wrangler secret put DEEPSEEK_API_KEY
```

部署脚本会依次：把 `database_id` 注入构建配置 → `vinext build` → 把 `drizzle/` 迁移应用到远程 D1 → `wrangler deploy`。首次部署时 wrangler 会提示注册一个 `workers.dev` 子域（免费），注册后即可通过 `https://sites-project.<子域>.workers.dev` 访问；如需用你自己的域名，在 Cloudflare 控制台把该域名绑定到这个 Worker 即可。
