#!/usr/bin/env node
// 无需 OpenAI Sites / ChatGPT 的 Cloudflare Workers 一键部署脚本。
//
// 前置条件（一次性）：
//   1) npm ci
//   2) npx wrangler login            —— 登录 Cloudflare
//   3) npx wrangler d1 create dueltective-db  —— 创建 D1，记下返回的 database_id
//
// 用法：
//   CLOUDFLARE_D1_DATABASE_ID=你的id npm run deploy:cloudflare
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
if (!databaseId) {
  console.error(
    [
      '缺少 CLOUDFLARE_D1_DATABASE_ID 环境变量。',
      '请先运行：  npx wrangler d1 create dueltective-db',
      '然后带上返回的 database_id 重新运行，例如：',
      '  CLOUDFLARE_D1_DATABASE_ID=xxxxxxxx npm run deploy:cloudflare',
    ].join('\n'),
  );
  process.exit(1);
}

function run(command, label) {
  console.log(`\n==> ${label}`);
  execSync(command, { stdio: 'inherit', env: process.env });
}

// 1) 构建：vite.config.ts 会读取 CLOUDFLARE_D1_DATABASE_ID 写入 wrangler.json
run('npm run build', '构建（注入 D1 database_id）');

// 2) 应用数据库迁移：把 drizzle 迁移转成纯 SQL 后写入远程 D1
const migrationFile = readdirSync('drizzle').find((name) =>
  name.endsWith('.sql'),
);
if (migrationFile) {
  const statements = readFileSync(join('drizzle', migrationFile), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  const tmp = '.d1-migration.sql';
  writeFileSync(tmp, statements.join(';\n') + ';\n');
  try {
    run(
      `npx wrangler d1 execute ${databaseId} --remote --file ${tmp}`,
      '应用数据库迁移',
    );
  } finally {
    rmSync(tmp, { force: true });
  }
}

// 3) 部署到 Cloudflare Workers
run('npx wrangler deploy --config dist/server/wrangler.json', '部署到 Cloudflare Workers');

// 4) 密钥提醒
console.log(`
==> 部署完成 ✅
    可选：设置 DeepSeek 密钥以启用 AI 出题/裁判：
      npx wrangler secret put DEEPSEEK_API_KEY
    其它可选环境变量：
      DEEPSEEK_MODEL / DEEPSEEK_API_BASE / AI_DAILY_LIMIT
`);
