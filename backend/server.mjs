// 纯后端 HTTP 服务，暴露与线上相同的接口，供本地自动化测试或独立联调使用。
// 先 `npm run backend:build` 生成 game.bundle.mjs，再 `node backend/server.mjs`（或直接 `npm run backend`）。
import { createServer } from 'node:http';
import {
  createRoom,
  act,
  getRoom,
  aiReady,
  newSession,
} from './game.bundle.mjs';

const PORT = Number(process.env.PORT) || 8787;

function json(data, status = 200, session) {
  const headers = {
    'Cache-Control': 'no-store, private',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  };
  if (session) {
    headers['Set-Cookie'] = `gf_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
  }
  return { status, headers, body: JSON.stringify(data) };
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 4096) {
      const error = new Error('内容太长了。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error();
    }
    return data;
  } catch {
    const error = new Error('请求格式不正确。');
    error.status = 400;
    throw error;
  }
}

function sessionOf(request) {
  return request.headers.cookie
    ?.match(/(?:^|;\s*)gf_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const path = url.pathname;
    const method = request.method;
    const send = (result) => {
      response.writeHead(result.status, result.headers);
      response.end(result.body);
    };

    if (method === 'GET' && path === '/api/config') {
      return send(json({ aiReady: aiReady() }));
    }

    if (method === 'POST' && path === '/api/rooms') {
      const input = await readBody(request);
      const session = sessionOf(request) || newSession();
      const room = await createRoom(session, input.name, input.category, 'local');
      return send(json(room, 200, session));
    }

    const match = path.match(/^\/api\/rooms\/([A-Z2-9]{6})$/);
    if (match) {
      const code = match[1];
      if (method === 'GET') {
        const session = sessionOf(request);
        if (!session) return send(json({ error: '请先加入这个房间。' }, 403));
        return send(json(await getRoom(code, session)));
      }
      if (method === 'POST') {
        const input = await readBody(request);
        const existing = sessionOf(request);
        if (!existing && input.action !== 'join') {
          return send(json({ error: '请先加入这个房间。' }, 403));
        }
        const session = existing || newSession();
        const room = await act(code, session, input, 'local');
        return send(json(room, 200, session));
      }
    }

    return send(json({ error: 'Not found' }, 404));
  } catch (error) {
    const status = error?.status ?? 500;
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify({ error: error?.message ?? '暂时无法完成，请稍后重试。' }),
    );
  }
});

server.listen(PORT, () => {
  console.log(`Dueltective 纯后端已启动：http://localhost:${PORT}`);
  console.log(`AI 状态：${aiReady() ? '已接入' : '未接入（demo 模式）'}`);
});
