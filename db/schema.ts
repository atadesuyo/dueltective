import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable(
  'rooms',
  {
    code: text('code').primaryKey(),
    revision: integer('revision').notNull(),
    state: text('state').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('rooms_expiry').on(t.expiresAt)],
);
export const limits = sqliteTable(
  'limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('limits_expiry').on(t.expiresAt)],
);
