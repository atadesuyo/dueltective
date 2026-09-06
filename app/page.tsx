'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  Link,
  LockKeyhole,
  RotateCcw,
  Send,
  Timer,
  Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CATEGORY_LABELS,
  type AskPrivacy,
  type GameCategory,
  type Room,
} from '@/lib/game-types';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

const categoryDetails: Record<GameCategory, { kicker: string; count: string }> =
  {
    overwatch: { kicker: 'HERO ARCHIVE', count: '当前全英雄' },
    'street-fighter-6': { kicker: 'WORLD WARRIORS', count: '31 位角色' },
    'pokemon-151': { kicker: 'KANTO FILES', count: '初代 151' },
  };

async function request<T = Room>(path: string, data?: object): Promise<T> {
  const response = await fetch(path, {
    method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json' } : {},
    body: data ? JSON.stringify(data) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(
        (result as { error?: string }).error || '连接暂时中断，请重试。',
      ),
      { status: response.status },
    );
  }
  return result as T;
}

function answerCopy(answer?: string) {
  if (answer === 'YES') return '是的。';
  if (answer === 'NO') return '不是。';
  return '这很难回答…';
}

export default function Home() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [tab, setTab] = useState('create');
  const [category, setCategory] = useState<GameCategory>('overwatch');
  const [room, setRoom] = useState<Room | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [network, setNetwork] = useState('');
  const [ready, setReady] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [askPrivacy, setAskPrivacy] = useState<AskPrivacy>('public');
  const [now, setNow] = useState(() => Date.now());
  const [restoring, setRestoring] = useState(true);
  const roomRef = useRef<Room | null>(null);
  const lastEvent = useRef<HTMLDivElement>(null);

  const apply = useCallback((next: Room) => {
    if (
      roomRef.current?.code === next.code &&
      next.revision < roomRef.current.revision
    ) {
      return;
    }
    roomRef.current = next;
    setRoom(next);
    setCategory(next.category);
  }, []);

  useEffect(() => {
    let canceled = false;
    const saved =
      new URLSearchParams(location.search).get('room') ||
      localStorage.getItem('gf-room');
    const savedName = localStorage.getItem('gf-name') || '';
    queueMicrotask(() => {
      if (canceled) return;
      setName(savedName);
      if (saved) {
        setCode(saved);
        setTab('join');
      } else {
        setRestoring(false);
      }
    });
    if (saved) {
      request('/api/rooms/' + encodeURIComponent(saved))
        .then((next) => {
          if (!canceled) apply(next);
        })
        .catch(() => {})
        .finally(() => {
          if (!canceled) setRestoring(false);
        });
    }
    request<{ aiReady: boolean }>('/api/config')
      .then((result) => {
        if (!canceled) setReady(result.aiReady);
      })
      .catch(() => {
        if (!canceled) setNetwork('暂时无法连接服务器，请刷新重试。');
      });
    return () => {
      canceled = true;
    };
  }, [apply]);

  useEffect(() => {
    if (!room?.code) return;
    let canceled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request('/api/rooms/' + room.code);
        if (!canceled) {
          apply(next);
          setNetwork('');
        }
      } catch (pollError) {
        if (!canceled) {
          setNetwork(
            pollError instanceof Error
              ? pollError.message
              : '连接中断，正在重连…',
          );
        }
      } finally {
        if (!canceled) timer = setTimeout(poll, 800);
      }
    };
    timer = setTimeout(poll, 1200);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [room?.code, apply]);

  useEffect(() => {
    if (!room?.deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [room?.deadline]);

  useEffect(() => {
    let canceled = false;
    queueMicrotask(() => {
      if (!canceled) {
        setAskPrivacy('public');
        setText('');
      }
    });
    return () => {
      canceled = true;
    };
  }, [room?.turn, room?.phase, room?.round]);

  useEffect(() => {
    lastEvent.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [room?.history.length]);

  const enter = useCallback(
    async (
      kind: 'create' | 'join',
      nickname: string,
      roomCode: string,
      selectedCategory: GameCategory,
    ) => {
      if (!nickname.trim() || nickname.trim().length > 16) {
        throw new Error('请填写 1–16 个字的名字。');
      }
      const next = await request<Room>(
        kind === 'create'
          ? '/api/rooms'
          : '/api/rooms/' + encodeURIComponent(roomCode.toUpperCase()),
        kind === 'create'
          ? { name: nickname, category: selectedCategory }
          : { action: 'join', name: nickname },
      );
      apply(next);
      localStorage.setItem('gf-room', next.code);
      localStorage.setItem('gf-name', nickname);
      history.replaceState(null, '', '?room=' + next.code);
      return next;
    },
    [apply],
  );

  const action = useCallback(
    async (kind: string, value?: string, extra?: object) => {
      const current = roomRef.current;
      if (!current) throw new Error('请先加入对局。');
      const next = await request<Room>('/api/rooms/' + current.code, {
        action: kind,
        text: value,
        revision: current.revision,
        ...extra,
      });
      if (roomRef.current?.code === current.code) apply(next);
      return next;
    },
    [apply],
  );

  const run = async (task: () => Promise<unknown>, clear = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
      if (clear) setText('');
    } catch (runError) {
      setError(
        runError instanceof Error ? runError.message : '操作未完成，请重试。',
      );
      const current = roomRef.current;
      if (current) {
        request<Room>('/api/rooms/' + current.code)
          .then((next) => {
            if (roomRef.current?.code === next.code) apply(next);
          })
          .catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (
      toolName: string,
      description: string,
      inputSchema: object,
      execute: (input: unknown) => unknown,
      readOnly = false,
    ) => {
      try {
        Promise.resolve(
          context.registerTool(
            {
              name: toolName,
              description,
              inputSchema,
              annotations: {
                readOnlyHint: readOnly,
                untrustedContentHint: true,
              },
              execute,
            },
            { signal: lifecycle.signal },
          ),
        ).catch(() => {});
      } catch {}
    };
    register(
      'read_game',
      'Read the current public Dueltective game state.',
      { type: 'object', properties: {}, additionalProperties: false },
      () => roomRef.current,
      true,
    );
    register(
      'create_game_room',
      'Create a two-player Dueltective room.',
      {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 16 },
          category: {
            enum: ['overwatch', 'street-fighter-6', 'pokemon-151'],
          },
        },
        required: ['name', 'category'],
        additionalProperties: false,
      },
      async (input) => {
        const value = input as { name?: unknown; category?: unknown };
        if (
          typeof value.name !== 'string' ||
          !['overwatch', 'street-fighter-6', 'pokemon-151'].includes(
            String(value.category),
          )
        ) {
          throw new Error('Name and category required');
        }
        return enter('create', value.name, '', value.category as GameCategory);
      },
    );
    register(
      'join_game_room',
      'Join a Dueltective room with its six-character code.',
      {
        type: 'object',
        properties: { name: { type: 'string' }, code: { type: 'string' } },
        required: ['name', 'code'],
        additionalProperties: false,
      },
      async (input) => {
        const value = input as { name?: unknown; code?: unknown };
        if (
          typeof value.name !== 'string' ||
          typeof value.code !== 'string' ||
          !/^[A-Z2-9]{6}$/i.test(value.code)
        ) {
          throw new Error('Name and valid code required');
        }
        return enter('join', value.name, value.code, category);
      },
    );
    register(
      'play_game_turn',
      'Start, confirm rules, ask, guess, pass, or request a rematch.',
      {
        type: 'object',
        properties: {
          action: {
            enum: ['start', 'ready', 'ask', 'guess', 'pass', 'restart'],
          },
          text: { type: 'string' },
          privacy: {
            enum: ['public', 'private-question', 'private-answer'],
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async (input) => {
        const value = input as {
          action?: unknown;
          text?: unknown;
          privacy?: unknown;
        };
        const validActions = [
          'start',
          'ready',
          'ask',
          'guess',
          'pass',
          'restart',
        ];
        if (
          typeof value.action !== 'string' ||
          !validActions.includes(value.action) ||
          (value.text !== undefined && typeof value.text !== 'string')
        ) {
          throw new Error('Invalid action');
        }
        return action(
          value.action,
          value.text as string | undefined,
          value.action === 'ask' && typeof value.privacy === 'string'
            ? { privacy: value.privacy }
            : undefined,
        );
      },
    );
    return () => lifecycle.abort();
  }, [action, category, enter]);

  const goBack = () => {
    roomRef.current = null;
    setRoom(null);
    setError('');
    setNetwork('');
    setText('');
    localStorage.removeItem('gf-room');
    history.replaceState(null, '', '/');
  };

  const copyValue = async (kind: 'code' | 'link') => {
    if (!room) return;
    const value =
      kind === 'code'
        ? room.code
        : `${window.location.origin}/?room=${room.code}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('请长按内容并手动复制。');
    }
  };

  const myTurn = room?.turn === room?.you;
  const locked = busy || room?.busy || Boolean(network);
  const currentName = room?.players[room.turn]?.name;
  const secondsLeft = room?.deadline
    ? Math.max(0, Math.ceil((room.deadline - now) / 1000))
    : null;
  const knownFacts = room
    ? room.history
        .filter((event) => event.kind === 'ask')
        .map((event) => ({
          id: event.id,
          text: event.text,
          answer: event.answer,
          hidden: event.answerHidden,
        }))
    : [];

  return (
    <main className={`shell ${room ? 'game-shell' : ''}`}>
      <header className="masthead">
        <button className="brand" type="button" onClick={goBack}>
          Dueltective
        </button>
        <span className="edition">
          {room ? `ROUND ${Math.max(1, room.round)}` : 'TWO PLAYER DEDUCTION'}
        </span>
      </header>

      {restoring ? (
        <output className="restoring">正在恢复对局…</output>
      ) : room ? (
        <>
          <div className="room-toolbar">
            <Button
              variant="ghost"
              className="back-button"
              onClick={goBack}
              disabled={busy}
            >
              <ChevronLeft /> 大厅
            </Button>
            <div className="share-actions">
              <button type="button" onClick={() => void copyValue('code')}>
                <span>对局密码</span>
                <strong>{room.code}</strong>
                {copied === 'code' ? <Check /> : <Copy />}
              </button>
              <button type="button" onClick={() => void copyValue('link')}>
                <Link />
                {copied === 'link' ? '网址已复制' : '复制邀请网址'}
              </button>
            </div>
            <span className="category-chip">
              {CATEGORY_LABELS[room.category]}
            </span>
          </div>

          <section className="game-workspace">
            <section className={`board phase-${room.phase}`}>
              {room.phase === 'lobby' ? (
                <div className="waiting-stage">
                  <span className="waiting-mark">{room.players.length}/2</span>
                  <p className="eyebrow">CASE FILE OPEN</p>
                  <h1>
                    {room.players.length === 2
                      ? '侦探到齐。'
                      : '等待另一位侦探。'}
                  </h1>
                  <p>
                    {room.players.length === 2
                      ? '房主可以发起这场对局。'
                      : '复制邀请网址，发给你的朋友。'}
                  </p>
                  <div className="waiting-detectives">
                    {[0, 1].map((index) => (
                      <div key={index}>
                        <span>{room.players[index]?.avatar || '🕵️'}</span>
                        <strong>
                          {room.players[index]?.name || '等待加入'}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <Button
                    className="primary-button"
                    disabled={
                      locked || room.players.length < 2 || room.you !== 0
                    }
                    onClick={() => void run(() => action('start'))}
                  >
                    {locked
                      ? '正在准备谜底…'
                      : room.you !== 0
                        ? '等待房主发起'
                        : room.players.length < 2
                          ? '等待朋友加入'
                          : '发起对局'}
                    <ArrowRight />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="secret-strip">
                    <LockKeyhole />
                    <span>本局的秘密</span>
                    <strong>
                      {room.phase === 'finished' ? room.answer : '● ● ● ● ● ●'}
                    </strong>
                    <em>{CATEGORY_LABELS[room.category]}</em>
                  </div>

                  <div className="known-info">
                    <span className="known-info-title">本局的已知信息</span>
                    {knownFacts.length ? (
                      <div className="known-info-list">
                        {knownFacts.map((fact) => (
                          <span className="known-fact" key={fact.id}>
                            <em>{fact.text}</em>
                            <strong>
                              {fact.hidden
                                ? '回答已隐藏'
                                : answerCopy(fact.answer)}
                            </strong>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <em className="known-info-empty">还没有已知信息</em>
                    )}
                  </div>

                  <div className="detective-bar">
                    {[0, 1].map((index) => {
                      const player = room.players[index];
                      if (!player) return null;
                      return (
                        <div
                          key={player.id}
                          className={`detective-card ${room.turn === index && room.phase !== 'finished' ? 'active' : ''} ${room.you === index ? 'self' : ''}`}
                        >
                          <span className="detective-avatar">
                            {player.avatar}
                          </span>
                          <div>
                            <strong>{player.name}</strong>
                            <small>
                              {player.lastResult === 'win'
                                ? '刚刚胜利'
                                : player.lastResult === 'loss'
                                  ? '刚刚失败'
                                  : '等待破案'}
                              {' · '}
                              {player.wins} 胜 {player.losses} 负
                            </small>
                          </div>
                          <span
                            className="life-count"
                            aria-label={`剩余 ${room.lives[index]} 次回答机会`}
                          >
                            {[0, 1, 2].map((heart) => (
                              <Heart
                                key={heart}
                                className={
                                  heart < room.lives[index] ? '' : 'used'
                                }
                              />
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="history"
                    aria-live="polite"
                    aria-relevant="additions"
                  >
                    <div className="case-opened">AI 已经藏好谜底。</div>
                    {room.history.map((event) => {
                      const isSelf = event.player === room.you;
                      const player = room.players[event.player];
                      if (event.kind === 'notice') {
                        return (
                          <div
                            className="system-line secret-notice"
                            key={event.id}
                          >
                            {event.text === 'PRIVATE_QUESTION_USED'
                              ? `${player.name} 使用了秘密提问。对方侦探无法看到这次的问题与答案。`
                              : `${player.name} 使用了秘密回答。对方侦探无法看到这次的答案。`}
                          </div>
                        );
                      }
                      if (event.kind === 'pass') {
                        return (
                          <div className="system-line" key={event.id}>
                            {player.name} 选择保持沉默。
                          </div>
                        );
                      }
                      if (
                        event.kind === 'timeout' &&
                        event.text === 'DECISION_TIMEOUT'
                      ) {
                        return (
                          <div className="system-line" key={event.id}>
                            {player.name} 没有作答，回合结束。
                          </div>
                        );
                      }
                      const isAskTimeout =
                        event.kind === 'timeout' &&
                        event.text === 'ASK_TIMEOUT';
                      return (
                        <article
                          className={`message-group ${isSelf ? 'message-self' : 'message-rival'}`}
                          key={event.id}
                        >
                          <header>
                            <span>{player.avatar}</span>
                            <div>
                              <strong>{player.name}</strong>
                              <small>
                                {player.lastResult === 'win'
                                  ? '刚刚胜利'
                                  : player.lastResult === 'loss'
                                    ? '刚刚失败'
                                    : '等待破案'}
                                {' · '}
                                {player.wins} 胜 {player.losses} 负
                              </small>
                            </div>
                          </header>
                          <div className="player-bubble">
                            {isAskTimeout ? '请问……' : event.text}
                            {event.privacy === 'private-question' && (
                              <LockKeyhole aria-label="秘密提问" />
                            )}
                            {event.privacy === 'private-answer' && (
                              <EyeOff aria-label="秘密回答" />
                            )}
                          </div>
                          {event.kind === 'ask' || isAskTimeout ? (
                            <div className="ai-reply">
                              <span>AI</span>
                              <p>
                                {isAskTimeout
                                  ? '抱歉，超时了。'
                                  : event.answerHidden
                                    ? '回答已隐藏。'
                                    : answerCopy(event.answer)}
                              </p>
                            </div>
                          ) : (
                            <div
                              className={`guess-result ${event.correct ? 'solved' : ''}`}
                            >
                              {event.correct ? '破案！' : '错误…'}
                            </div>
                          )}
                        </article>
                      );
                    })}
                    <div ref={lastEvent} />
                  </div>

                  {room.phase === 'ask' || room.phase === 'priority' ? (
                    <div className={`composer ${myTurn ? 'your-turn' : ''}`}>
                      <div className="composer-title">
                        <span className="turn-light" />
                        <strong>
                          {room.busy
                            ? 'AI 正在判断…'
                            : myTurn
                              ? room.phase === 'priority'
                                ? '请回答，或者保持沉默'
                                : '轮到你提问'
                              : room.phase === 'priority'
                                ? `${currentName} 正在决定…`
                                : `${currentName} 正在思考…`}
                        </strong>
                        {secondsLeft !== null && (
                          <span
                            className={`countdown ${secondsLeft <= 5 ? 'urgent' : ''}`}
                          >
                            <Timer /> {secondsLeft}
                          </span>
                        )}
                      </div>
                      {myTurn ? (
                        <>
                          {room.phase === 'ask' && (
                            <div
                              className="privacy-options"
                              aria-label="秘密卡选择"
                            >
                              <button
                                type="button"
                                className={
                                  askPrivacy === 'public' ? 'selected' : ''
                                }
                                onClick={() => setAskPrivacy('public')}
                                disabled={locked}
                              >
                                <Eye /> 公开
                              </button>
                              <button
                                type="button"
                                className={
                                  askPrivacy === 'private-question'
                                    ? 'selected'
                                    : ''
                                }
                                onClick={() =>
                                  setAskPrivacy('private-question')
                                }
                                disabled={
                                  locked ||
                                  !room.abilities[room.you].privateQuestion
                                }
                              >
                                <LockKeyhole /> 秘密问题
                              </button>
                              <button
                                type="button"
                                className={
                                  askPrivacy === 'private-answer'
                                    ? 'selected'
                                    : ''
                                }
                                onClick={() => setAskPrivacy('private-answer')}
                                disabled={
                                  locked ||
                                  !room.abilities[room.you].privateAnswer
                                }
                              >
                                <EyeOff /> 秘密回答
                              </button>
                            </div>
                          )}
                          <form
                            className="compose-form"
                            onSubmit={(submitEvent) => {
                              submitEvent.preventDefault();
                              void run(
                                () =>
                                  action(
                                    room.phase === 'priority' ? 'guess' : 'ask',
                                    text,
                                    room.phase === 'ask'
                                      ? { privacy: askPrivacy }
                                      : undefined,
                                  ),
                                true,
                              );
                            }}
                          >
                            <Input
                              aria-label={
                                room.phase === 'priority'
                                  ? '写下答案'
                                  : '写下问题'
                              }
                              disabled={
                                locked ||
                                secondsLeft === 0 ||
                                (room.phase === 'priority' &&
                                  room.lives[room.you] <= 0)
                              }
                              maxLength={room.phase === 'priority' ? 80 : 200}
                              placeholder={
                                room.phase === 'priority'
                                  ? '写下你的答案…'
                                  : '写下你的问题…'
                              }
                              value={text}
                              onChange={(changeEvent) =>
                                setText(changeEvent.target.value)
                              }
                            />
                            <Button
                              className="send-button"
                              type="submit"
                              disabled={
                                locked ||
                                !text.trim() ||
                                secondsLeft === 0 ||
                                (room.phase === 'priority' &&
                                  room.lives[room.you] <= 0)
                              }
                            >
                              {room.phase === 'priority' ? '回答' : '提问'}
                              <Send />
                            </Button>
                          </form>
                          {room.phase === 'priority' ? (
                            <Button
                              className="pass-button"
                              variant="ghost"
                              disabled={locked || secondsLeft === 0}
                              onClick={() =>
                                void run(() => action('pass'), true)
                              }
                            >
                              保持沉默 <ArrowRight />
                            </Button>
                          ) : room.mode === 'demo' ? (
                            <div className="suggestions">
                              {room.questions.map((question) => (
                                <button
                                  key={question}
                                  type="button"
                                  disabled={locked}
                                  onClick={() =>
                                    void run(
                                      () =>
                                        action('ask', question, {
                                          privacy: askPrivacy,
                                        }),
                                      true,
                                    )
                                  }
                                >
                                  {question}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="waiting-copy">
                          你会同时看到公开的问题与回答。
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="briefing-placeholder">
                      等待双方确认规则。
                    </div>
                  )}

                  {(error || network) && (
                    <div className="status-error" role="alert">
                      {error || `${network} 正在重连…`}
                    </div>
                  )}
                </>
              )}
            </section>
          </section>

          <Dialog open={room.phase === 'briefing'}>
            <DialogContent showCloseButton={false} className="rules-dialog">
              <DialogHeader>
                <span className="eyebrow">BEFORE THE CLOCK STARTS</span>
                <DialogTitle>这个游戏很简单。</DialogTitle>
                <DialogDescription>
                  两位侦探都确认后，第一位玩家的 60 秒计时开始。
                </DialogDescription>
              </DialogHeader>
              <ol>
                <li>
                  两位侦探可以问任何问题，AI
                  只会回答“是的”“不是”或“这很难回答”。
                </li>
                <li>提问之后可以进行回答，或者保持沉默。</li>
                <li>你的提问都会被对手看到——除非你使用“秘密卡”。</li>
                <li>你有总共 60 秒完成提问和回答。</li>
                <li>你有 3 次回答机会，归零即失败，猜中即胜利。</li>
              </ol>
              <div className="ready-status">
                {room.players.map((player, index) => (
                  <span
                    key={player.id}
                    className={room.ready.includes(index) ? 'confirmed' : ''}
                  >
                    {player.avatar} {player.name}{' '}
                    {room.ready.includes(index) ? '已确认' : '阅读中'}
                  </span>
                ))}
              </div>
              <Button
                className="primary-button"
                disabled={locked || room.ready.includes(room.you)}
                onClick={() => void run(() => action('ready'))}
              >
                {room.ready.includes(room.you) ? '等待另一位侦探' : '开始吧'}
                <ArrowRight />
              </Button>
            </DialogContent>
          </Dialog>

          <Dialog open={room.phase === 'finished'}>
            <DialogContent showCloseButton={false} className="result-dialog">
              <div className="result-mark">
                <Trophy />
              </div>
              <span className="eyebrow">CASE CLOSED</span>
              <DialogTitle>
                侦探 {room.players[room.winner ?? 0]?.name}{' '}
                {room.winReason === 'correct' ? '推理成功' : '不战而胜'}
              </DialogTitle>
              <DialogDescription>
                {room.winReason === 'correct'
                  ? '一举猜中了谜底。'
                  : '对方用完了全部回答机会。'}
              </DialogDescription>
              <p className="result-answer">
                谜底是 <strong>{room.answer}</strong>
              </p>
              <Button
                className={`primary-button rematch-button ${room.ready.includes(room.you) ? 'is-ready' : ''}`}
                disabled={locked || room.ready.includes(room.you)}
                onClick={() => void run(() => action('restart'))}
              >
                {room.ready.includes(room.you)
                  ? '已准备 · 等待对方'
                  : room.ready.length
                    ? '对方想再来一局'
                    : '再来一局'}
                {room.ready.includes(room.you) ? <Check /> : <RotateCcw />}
              </Button>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <section className="lobby">
          <div className="lobby-title">
            <span>Two Detectives. One Secret.</span>
            <h1>Dueltective</h1>
            <p>把你想知道的摆上牌桌……或者保持沉默。</p>
          </div>

          <section className="entry-panel">
            <fieldset className="category-fieldset">
              <legend>选择题库</legend>
              <RadioGroup
                value={category}
                onValueChange={(value) => setCategory(value as GameCategory)}
                className="category-grid"
              >
                {(Object.keys(CATEGORY_LABELS) as GameCategory[]).map(
                  (categoryKey) => (
                    <label
                      className="category-option"
                      htmlFor={`category-${categoryKey}`}
                      key={categoryKey}
                    >
                      <RadioGroupItem
                        id={`category-${categoryKey}`}
                        value={categoryKey}
                      />
                      <span>
                        <small>{categoryDetails[categoryKey].kicker}</small>
                        <strong>{CATEGORY_LABELS[categoryKey]}</strong>
                        <em>{categoryDetails[categoryKey].count}</em>
                      </span>
                    </label>
                  ),
                )}
              </RadioGroup>
            </fieldset>

            <label className="input-label" htmlFor="name">
              输入你的名字
            </label>
            <Input
              id="name"
              autoComplete="nickname"
              placeholder="侦探姓名"
              maxLength={16}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList className="entry-tabs">
                <TabsTrigger value="create">发起对局</TabsTrigger>
                <TabsTrigger value="join">加入对局</TabsTrigger>
              </TabsList>
              <TabsContent value="create">
                <form
                  onSubmit={(submitEvent) => {
                    submitEvent.preventDefault();
                    void run(() => enter('create', name, code, category));
                  }}
                >
                  <p className="tab-copy">
                    发起后，将 6 位对局密码发给好友。两人到齐，即可开始。
                  </p>
                  <Button
                    type="submit"
                    className="primary-button"
                    disabled={!name.trim() || busy || ready === null}
                  >
                    {busy ? '正在发起…' : '确认发起对局'} <ArrowRight />
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="join">
                <form
                  onSubmit={(submitEvent) => {
                    submitEvent.preventDefault();
                    void run(() => enter('join', name, code, category));
                  }}
                >
                  <label className="input-label" htmlFor="code">
                    对局密码
                  </label>
                  <Input
                    id="code"
                    autoComplete="off"
                    className="code-input"
                    placeholder="ABC123"
                    value={code}
                    maxLength={6}
                    onChange={(event) =>
                      setCode(
                        event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z2-9]/g, ''),
                      )
                    }
                  />
                  <Button
                    type="submit"
                    className="primary-button"
                    disabled={
                      !name.trim() ||
                      code.length !== 6 ||
                      busy ||
                      ready === null
                    }
                  >
                    {busy ? '正在加入…' : '确认加入对局'} <KeyRound />
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {(error || network) && (
              <div className="status-error" role="alert">
                {error || network}
              </div>
            )}
          </section>
        </section>
      )}
    </main>
  );
}
