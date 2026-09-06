import { env } from 'cloudflare:workers';
import type {
  AbilityState,
  AskPrivacy,
  Event,
  GameCategory,
  Phase,
  Room,
} from '../game-types';
import { db, GameError, hash, rateLimit, str } from './storage';
import { aiReady, chooseSecret, answerQuestion } from './ai';
import { demoSecret, demoAnswer, questionsFor, type Secret } from './demo';
import { isCategory } from './rosters';

type StoredEvent = Event & {
  onlyFor?: number;
  hideAnswerFrom?: number;
};
type State = {
  players: { id: string; name: string; sessionHash: string }[];
  phase: Phase;
  turn: number;
  round: number;
  history: StoredEvent[];
  winner: number | null;
  winReason?: 'correct' | 'out-of-lives';
  mode: 'ai' | 'demo';
  secret?: Secret;
  pending?: { id: string; until: number };
  ready: number[];
  deadline: number | null;
  lives: [number, number];
  abilities: [AbilityState, AbilityState];
  category: GameCategory;
  turnRemaining?: number;
  avatars: [string, string];
  records: [PlayerRecord, PlayerRecord];
  lastWinner: number | null;
  recentSecrets: string[];
};
type Stored = { code: string; revision: number; state: State };
type PlayerRecord = { wins: number; losses: number };

const settings = () => env as unknown as Record<string, string>;
function duration(
  name: 'TURN_TIMEOUT_MS' | 'ASK_TIMEOUT_MS' | 'DECISION_TIMEOUT_MS',
) {
  const fallback =
    name === 'TURN_TIMEOUT_MS'
      ? 60000
      : name === 'ASK_TIMEOUT_MS'
        ? 25000
        : 15000;
  const value = Number(settings()[name]);
  return Number.isFinite(value) && value >= 250 && value <= 120000
    ? value
    : fallback;
}
function freshAbilities(): [AbilityState, AbilityState] {
  return [
    { privateQuestion: true, privateAnswer: true },
    { privateQuestion: true, privateAnswer: true },
  ];
}
const detectiveAvatars = ['🕵️‍♀️', '🕵️‍♂️'];
function freshAvatars(): [string, string] {
  const bytes = crypto.getRandomValues(new Uint8Array(2));
  const first = bytes[0] % detectiveAvatars.length;
  let second = bytes[1] % (detectiveAvatars.length - 1);
  if (second >= first) second++;
  return [detectiveAvatars[first], detectiveAvatars[second]];
}
function freshRecords(): [PlayerRecord, PlayerRecord] {
  return [
    { wins: 0, losses: 0 },
    { wins: 0, losses: 0 },
  ];
}
function hydrate(s: State) {
  let changed = false;
  if (!Array.isArray(s.lives)) {
    s.lives = [3, 3];
    changed = true;
  } else if (s.lives[0] > 3 || s.lives[1] > 3) {
    s.lives = [Math.min(3, s.lives[0]), Math.min(3, s.lives[1])];
    changed = true;
  }
  if (!Array.isArray(s.abilities)) {
    s.abilities = freshAbilities();
    changed = true;
  }
  if (!isCategory(s.category)) {
    s.category = 'overwatch';
    changed = true;
  }
  if (!Array.isArray(s.avatars) || s.avatars.length !== 2) {
    s.avatars = freshAvatars();
    changed = true;
  }
  if (!Array.isArray(s.records) || s.records.length !== 2) {
    s.records = freshRecords();
    changed = true;
  }
  if (s.lastWinner === undefined) {
    s.lastWinner = null;
    changed = true;
  }
  if (!Array.isArray(s.recentSecrets)) {
    s.recentSecrets = s.secret?.name ? [s.secret.name] : [];
    changed = true;
  } else if (s.recentSecrets.length > 2) {
    s.recentSecrets = s.recentSecrets.slice(0, 2);
    changed = true;
  }
  if (s.deadline === undefined) {
    s.deadline =
      s.phase === 'ask'
        ? Date.now() + duration('TURN_TIMEOUT_MS')
        : s.phase === 'priority'
          ? Date.now() + duration('DECISION_TIMEOUT_MS')
          : null;
    changed = true;
  }
  if (s.turnRemaining !== undefined) {
    delete s.turnRemaining;
    changed = true;
  }
  for (const event of s.history) {
    if (event.answer === ('Yes' as string)) {
      event.answer = 'YES';
      changed = true;
    } else if (event.answer === ('No' as string)) {
      event.answer = 'NO';
      changed = true;
    }
  }
  return changed;
}
function visibleEvent(event: StoredEvent, who: number): Event | null {
  if (event.onlyFor !== undefined && event.onlyFor !== who) return null;
  const projected: Event = {
    id: event.id,
    player: event.player,
    kind: event.kind,
    text: event.text,
    ...(event.answer ? { answer: event.answer } : {}),
    ...(event.correct !== undefined ? { correct: event.correct } : {}),
    ...(event.privacy ? { privacy: event.privacy } : {}),
  };
  if (event.hideAnswerFrom === who) {
    delete projected.answer;
    projected.answerHidden = true;
  }
  return projected;
}
function view(r: Stored, me: string): Room {
  const s = r.state;
  const who = s.players.findIndex((player) => player.sessionHash === me);
  return {
    code: r.code,
    revision: r.revision,
    players: s.players.map(({ id, name }, index) => ({
      id,
      name,
      avatar: s.avatars[index] || '🕵️',
      wins: s.records[index]?.wins || 0,
      losses: s.records[index]?.losses || 0,
      lastResult:
        s.lastWinner === null ? null : s.lastWinner === index ? 'win' : 'loss',
    })),
    you: who,
    phase: s.phase,
    turn: s.turn,
    round: s.round,
    history: s.history
      .map((event) => visibleEvent(event, who))
      .filter((event): event is Event => Boolean(event)),
    winner: s.winner,
    ...(s.phase === 'finished' ? { answer: s.secret?.name } : {}),
    ...(s.winReason ? { winReason: s.winReason } : {}),
    busy: Boolean(s.pending),
    mode: s.mode,
    questions: s.mode === 'demo' ? questionsFor(s.category) : [],
    ready: s.ready,
    deadline: s.pending ? null : s.deadline,
    lives: s.lives,
    abilities: s.abilities,
    category: s.category,
  };
}
async function read(code: string) {
  if (!/^[A-Z2-9]{6}$/.test(code))
    throw new GameError(400, '请输入正确的 6 位房间码。');
  const row = await db()
    .prepare(
      'SELECT code,revision,state FROM rooms WHERE code=? AND expires_at>?',
    )
    .bind(code, Date.now())
    .first<{ code: string; revision: number; state: string }>();
  if (!row) throw new GameError(404, '房间不存在或已过期，请检查房间码。');
  return { ...row, state: JSON.parse(row.state) as State };
}
async function save(r: Stored) {
  const result = await db()
    .prepare(
      'UPDATE rooms SET state=?,revision=revision+1,expires_at=? WHERE code=? AND revision=?',
    )
    .bind(JSON.stringify(r.state), Date.now() + 86400000, r.code, r.revision)
    .run();
  if (!result.meta.changes)
    throw new GameError(409, '对局已更新，正在同步，请再试一次。');
  r.revision++;
}
function nextTurn(s: State, now = Date.now()) {
  s.turn = 1 - s.turn;
  s.phase = 'ask';
  s.deadline = now + duration('TURN_TIMEOUT_MS');
  delete s.turnRemaining;
}
function finishRound(
  s: State,
  winner: number,
  reason: 'correct' | 'out-of-lives',
) {
  s.phase = 'finished';
  s.winner = winner;
  s.lastWinner = winner;
  s.winReason = reason;
  s.deadline = null;
  s.ready = [];
  s.records[winner].wins++;
  s.records[1 - winner].losses++;
}
async function recover(input: Stored): Promise<Stored> {
  let r = input;
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = r.state;
    let changed = hydrate(s);
    const now = Date.now();
    if (s.pending?.until && s.pending.until < now) {
      delete s.pending;
      const remaining = s.turnRemaining;
      delete s.turnRemaining;
      s.deadline =
        s.phase === 'priority'
          ? now + (remaining ?? duration('DECISION_TIMEOUT_MS'))
          : s.phase === 'ask'
            ? now + (remaining ?? duration('TURN_TIMEOUT_MS'))
            : null;
      changed = true;
    }
    if (
      !s.pending &&
      s.deadline !== null &&
      s.deadline <= now &&
      (s.phase === 'ask' || s.phase === 'priority')
    ) {
      s.history.push({
        id: crypto.randomUUID(),
        player: s.turn,
        kind: 'timeout',
        text: s.phase === 'ask' ? 'ASK_TIMEOUT' : 'DECISION_TIMEOUT',
      });
      nextTurn(s, now);
      changed = true;
    }
    if (!changed) return r;
    try {
      await save(r);
      return r;
    } catch (error) {
      if (!(error instanceof GameError) || error.status !== 409 || attempt)
        throw error;
      r = await read(r.code);
    }
  }
  return r;
}
function member(r: Stored, me: string) {
  const index = r.state.players.findIndex(
    (player) => player.sessionHash === me,
  );
  if (index < 0) throw new GameError(403, '请先加入这个房间。');
  return index;
}
export async function getRoom(code: string, session: string) {
  const me = await hash(session);
  const r = await recover(await read(code));
  member(r, me);
  return view(r, me);
}
export async function createRoom(
  session: string,
  name: unknown,
  categoryInput: unknown,
  ip: string,
) {
  const playerName = str(name, 16, '昵称');
  const category: GameCategory = isCategory(categoryInput)
    ? categoryInput
    : 'overwatch';
  const me = await hash(session);
  await rateLimit('create:' + (await hash(ip)), 20, 3600000);
  await rateLimit('create-session:' + me, 8, 3600000);
  await db().batch([
    db()
      .prepare(
        'DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE expires_at<? LIMIT 100)',
      )
      .bind(Date.now()),
    db()
      .prepare(
        'DELETE FROM limits WHERE key IN (SELECT key FROM limits WHERE expires_at<? LIMIT 100)',
      )
      .bind(Date.now()),
  ]);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 5; tries++) {
    const code = Array.from(
      crypto.getRandomValues(new Uint8Array(6)),
      (value) => alphabet[value % alphabet.length],
    ).join('');
    const state: State = {
      players: [{ id: crypto.randomUUID(), name: playerName, sessionHash: me }],
      phase: 'lobby',
      turn: 0,
      round: 0,
      history: [],
      winner: null,
      mode: aiReady() ? 'ai' : 'demo',
      ready: [],
      deadline: null,
      lives: [3, 3],
      abilities: freshAbilities(),
      category,
      avatars: freshAvatars(),
      records: freshRecords(),
      lastWinner: null,
      recentSecrets: [],
    };
    const inserted = await db()
      .prepare(
        'INSERT OR IGNORE INTO rooms (code,revision,state,expires_at) VALUES (?,0,?,?)',
      )
      .bind(code, JSON.stringify(state), Date.now() + 86400000)
      .run();
    if (inserted.meta.changes) return view({ code, revision: 0, state }, me);
  }
  throw new GameError(503, '房间创建失败，请重试。');
}
function normalizeGuess(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}
export async function act(
  code: string,
  session: string,
  input: Record<string, unknown>,
  ip: string,
) {
  const me = await hash(session);
  const r = await recover(await read(code));
  const s = r.state;
  const action = input.action;
  if (action === 'join') {
    const existing = s.players.findIndex((player) => player.sessionHash === me);
    if (existing >= 0) return view(r, me);
    await rateLimit('join:' + (await hash(ip)), 30, 60000);
    if (s.players.length >= 2 || s.phase !== 'lobby')
      throw new GameError(409, '房间已满或对局已开始。');
    s.players.push({
      id: crypto.randomUUID(),
      name: str(input.name, 16, '昵称'),
      sessionHash: me,
    });
    await save(r);
    return view(r, me);
  }
  const who = member(r, me);
  if (input.revision !== r.revision)
    throw new GameError(409, '对局已更新，正在同步，请再试一次。');
  if (s.pending) throw new GameError(409, '正在处理上一次操作，请稍候。');
  if (action === 'start') {
    if (who !== 0) throw new GameError(403, '请等待房主开始。');
    if (s.phase !== 'lobby' || s.players.length !== 2)
      throw new GameError(409, '需要两位玩家到齐后开始。');
  } else if (action === 'restart') {
    if (s.phase !== 'finished') throw new GameError(409, '本局还没有结束。');
    if (!s.ready.includes(who)) s.ready.push(who);
    if (s.ready.length < 2) {
      await save(r);
      return view(r, me);
    }
  } else if (action === 'ready') {
    if (s.phase !== 'briefing')
      throw new GameError(409, '当前没有等待确认的规则说明。');
    if (!s.ready.includes(who)) s.ready.push(who);
    if (s.ready.length === 2) {
      s.phase = 'ask';
      s.deadline = Date.now() + duration('TURN_TIMEOUT_MS');
    }
    await save(r);
    return view(r, me);
  } else {
    if (s.phase === 'lobby' || s.phase === 'briefing' || s.phase === 'finished')
      throw new GameError(409, '当前阶段无法操作。');
    if (who !== s.turn) throw new GameError(403, '现在是对方的回合。');
    if (action === 'ask' && s.phase !== 'ask')
      throw new GameError(409, '请先选择 Guess 或 Pass。');
    if ((action === 'guess' || action === 'pass') && s.phase !== 'priority')
      throw new GameError(409, '每回合必须先提一个问题。');
    if (!['ask', 'guess', 'pass'].includes(String(action)))
      throw new GameError(400, '未知操作。');
  }
  if (action === 'pass') {
    s.history.push({
      id: crypto.randomUUID(),
      player: who,
      kind: 'pass',
      text: 'PASS',
    });
    nextTurn(s);
    await save(r);
    return view(r, me);
  }
  if (action === 'guess') {
    if (s.lives[who] <= 0) throw new GameError(409, '你已经没有可用的 Guess。');
    const guess = str(input.text, 80, '答案');
    s.lives[who]--;
    const correct = [s.secret!.name, ...s.secret!.aliases].some(
      (answer) => normalizeGuess(answer) === normalizeGuess(guess),
    );
    s.history.push({
      id: crypto.randomUUID(),
      player: who,
      kind: 'guess',
      text: guess,
      correct,
    });
    if (correct) {
      finishRound(s, who, 'correct');
    } else if (s.lives[who] === 0) {
      finishRound(s, 1 - who, 'out-of-lives');
    } else {
      nextTurn(s);
    }
    await save(r);
    return view(r, me);
  }

  const text = action === 'ask' ? str(input.text, 200, '问题') : '';
  const privacy: AskPrivacy =
    action === 'ask' &&
    (input.privacy === 'private-question' || input.privacy === 'private-answer')
      ? input.privacy
      : 'public';
  if (privacy === 'private-question' && !s.abilities[who].privateQuestion)
    throw new GameError(409, '你的 Private Question 已经使用过了。');
  if (privacy === 'private-answer' && !s.abilities[who].privateAnswer)
    throw new GameError(409, '你的 Private Answer 已经使用过了。');

  await rateLimit('actions:' + me, 30, 60000);
  const pendingId = crypto.randomUUID();
  if (action === 'ask') {
    s.turnRemaining = Math.max(0, (s.deadline ?? Date.now()) - Date.now());
  }
  s.pending = { id: pendingId, until: Date.now() + 40000 };
  s.deadline = null;
  await save(r);
  try {
    if (action === 'start' || action === 'restart') {
      const secret =
        s.mode === 'ai'
          ? await chooseSecret(s.category, s.recentSecrets)
          : demoSecret(s.category, s.recentSecrets);
      s.secret = secret;
      s.recentSecrets = [
        secret.name,
        ...s.recentSecrets.filter((name) => name !== secret.name),
      ].slice(0, 2);
      s.round++;
      s.turn = (s.round - 1) % 2;
      s.phase = 'briefing';
      s.history = [];
      s.winner = null;
      delete s.winReason;
      s.ready = [];
      s.lives = [3, 3];
      s.abilities = freshAbilities();
      s.avatars = freshAvatars();
      s.deadline = null;
      delete s.turnRemaining;
    } else {
      const answer =
        s.mode === 'ai'
          ? await answerQuestion(
              s.secret!,
              text,
              s.history
                .filter((event) => event.kind === 'ask')
                .map((event) => ({ text: event.text, answer: event.answer })),
            )
          : demoAnswer(s.secret!, text);
      const event: StoredEvent = {
        id: crypto.randomUUID(),
        player: who,
        kind: 'ask',
        text,
        answer,
        privacy,
      };
      if (privacy === 'private-question') {
        event.onlyFor = who;
        s.abilities[who].privateQuestion = false;
      } else if (privacy === 'private-answer') {
        event.hideAnswerFrom = 1 - who;
        s.abilities[who].privateAnswer = false;
      }
      s.history.push(event);
      if (privacy !== 'public') {
        s.history.push({
          id: crypto.randomUUID(),
          player: who,
          kind: 'notice',
          text:
            privacy === 'private-question'
              ? 'PRIVATE_QUESTION_USED'
              : 'PRIVATE_ANSWER_USED',
        });
      }
      s.phase = 'priority';
      s.deadline =
        Date.now() + (s.turnRemaining ?? duration('DECISION_TIMEOUT_MS'));
      delete s.turnRemaining;
    }
    delete s.pending;
    await save(r);
    return view(r, me);
  } catch (error) {
    const current = await read(code);
    if (current.state.pending?.id === pendingId) {
      delete current.state.pending;
      const remaining = current.state.turnRemaining;
      delete current.state.turnRemaining;
      current.state.deadline =
        current.state.phase === 'priority'
          ? Date.now() + (remaining ?? duration('DECISION_TIMEOUT_MS'))
          : current.state.phase === 'ask'
            ? Date.now() + (remaining ?? duration('TURN_TIMEOUT_MS'))
            : null;
      await save(current);
    }
    throw error;
  }
}
