import { env } from 'cloudflare:workers';
export function db() {
  if (!env.DB) throw new Error('Database binding missing');
  return env.DB;
}
export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const slot = Math.floor(now / windowMs);
  const r = await db()
    .prepare(
      'INSERT INTO limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count',
    )
    .bind(key + ':' + slot, (slot + 1) * windowMs, max)
    .first();
  if (!r) throw new GameError(429, '操作太频繁，请稍后再试。');
}
export async function hash(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function getSession(request: Request) {
  return request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)gf_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}
export function newSession() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

const trustedOrigins = new Set([
  'https://dueltective.ata.it.com',
  'https://dueltective.vercel.app',
  'https://dueltective-74kk17zgm-ata-5c7f.vercel.app',
]);

export async function body(request: Request) {
  const origin = request.headers.get('origin');
  if (
    origin !== new URL(request.url).origin &&
    !trustedOrigins.has(origin ?? '')
  )
    throw new GameError(403, '请从游戏页面操作。');
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new GameError(415, '请求格式不正确。');
  const reader = request.body?.getReader();
  if (!reader) throw new GameError(400, '请求内容为空。');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 4096) {
      await reader.cancel();
      throw new GameError(413, '内容太长了。');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error();
    return data as Record<string, unknown>;
  } catch {
    throw new GameError(400, '请求格式不正确。');
  }
}
export function str(v: unknown, max: number, label: string) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
    throw new GameError(400, `${label}请填写 1–${max} 个字。`);
  return v.trim();
}
export function json(
  data: unknown,
  status = 200,
  session?: string,
  request?: Request,
) {
  const headers = new Headers({
    'Cache-Control': 'no-store, private',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  if (session)
    headers.set(
      'Set-Cookie',
      `gf_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${request && new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
    );
  return new Response(JSON.stringify(data), { status, headers });
}
export function failure(error: unknown) {
  return error instanceof GameError
    ? json({ error: error.message }, error.status)
    : json({ error: '暂时无法完成，请稍后重试。' }, 500);
}
