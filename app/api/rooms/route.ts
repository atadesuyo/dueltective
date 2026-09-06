import { createRoom } from '@/lib/server/game';
import {
  body,
  getSession,
  newSession,
  json,
  failure,
} from '@/lib/server/storage';
export async function POST(request: Request) {
  try {
    const input = await body(request);
    const session = getSession(request) || newSession();
    return json(
      await createRoom(
        session,
        input.name,
        input.category,
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
