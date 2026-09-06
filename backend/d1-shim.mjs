// 用 Node 内置 SQLite 模拟 Cloudflare D1 的最小接口，供本地纯后端运行真实游戏逻辑。
import { DatabaseSync } from 'node:sqlite';

let database = null;

function raw() {
  if (database) return database;
  const path =
    process.env.DUELTECTIVE_DB_PATH || ':memory:';
  database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE IF NOT EXISTS limits (
      key text PRIMARY KEY NOT NULL,
      count integer NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS limits_expiry ON limits (expires_at);
    CREATE TABLE IF NOT EXISTS rooms (
      code text PRIMARY KEY NOT NULL,
      revision integer NOT NULL,
      state text NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rooms_expiry ON rooms (expires_at);
  `);
  return database;
}

class PreparedStatement {
  constructor(sql) {
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  first() {
    return raw().prepare(this.sql).get(...this.params) ?? null;
  }
  all() {
    return raw().prepare(this.sql).all(...this.params);
  }
  run() {
    const result = raw().prepare(this.sql).run(...this.params);
    return {
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class D1Database {
  prepare(sql) {
    return new PreparedStatement(sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(statement.run());
    }
    return results;
  }
}

let d1 = null;
export function openD1() {
  if (!d1) d1 = new D1Database();
  return d1;
}
