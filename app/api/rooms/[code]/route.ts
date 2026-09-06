import { act, getRoom } from '@/lib/server/game';
import {
  body,
  getSession,
  newSession,
  json,
  failure,
  GameError,
} from '@/lib/server/storage';
type Context = { params: Promise<{ code: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const session = getSession(request);
    if (!session) throw new GameError(403, '请先加入这个房间。');
    return json(await getRoom((await context.params).code, session));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const input = await body(request);
    const existing = getSession(request);
    if (!existing && input.action !== 'join')
      throw new GameError(403, '请先加入这个房间。');
    const session = existing || newSession();
    return json(
      await act(
        (await context.params).code,
        session,
        input,
        request.headers.get('cf-connecting-ip') || 'local',
      ),
      200,
      session,
      request,
    );
  } catch (e) {
    return failure(e);
  }
}
