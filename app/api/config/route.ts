import { aiReady } from '@/lib/server/ai';
import { json } from '@/lib/server/storage';
export async function GET() {
  return json({ aiReady: aiReady() });
}
