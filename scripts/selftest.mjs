// 纯后端自动化自测：直接调用打包后的真实游戏逻辑，模拟两位玩家完整对局并断言规则。
// 运行：npm run selftest
import assert from 'node:assert/strict';

process.env.DUELTECTIVE_DB_PATH = ':memory:';
const { createRoom, act, getRoom, aiReady } = await import(
  '../backend/game.bundle.mjs'
);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  }
}
function expects(status, fn) {
  return async () => {
    try {
      await fn();
      assert.fail(`expected error status ${status}`);
    } catch (error) {
      assert.equal(error.status, status);
    }
  };
}

const HOST = 'self-test-host';
const GUEST = 'self-test-guest';
let code;
let rev = 0;

// —— 主流程：demo 模式完整对局 ——
await (async () => {
  const made = await createRoom(HOST, '侦探A', 'pokemon-151', 'test');
  code = made.code;
  rev = made.revision;
  await check('创建房间并进入 demo 模式', () => {
    assert.equal(made.mode, 'demo');
    assert.equal(made.category, 'pokemon-151');
  });

  let room = await act(code, GUEST, { action: 'join', name: '侦探B' }, 'test');
  rev = room.revision;
  await check('第二名玩家加入且头像不同', () => {
    assert.equal(room.players.length, 2);
    assert.notEqual(room.players[0].avatar, room.players[1].avatar);
  });

  await check(
    '非房主无法开始',
    expects(403, () =>
      act(code, GUEST, { action: 'start', revision: rev }, 'test'),
    ),
  );

  room = await act(code, HOST, { action: 'start', revision: rev }, 'test');
  rev = room.revision;
  await check('房主开始进入 briefing', () => {
    assert.equal(room.phase, 'briefing');
    assert.equal(room.deadline, null);
  });

  room = await act(code, HOST, { action: 'ready', revision: rev }, 'test');
  rev = room.revision;
  room = await act(code, GUEST, { action: 'ready', revision: rev }, 'test');
  rev = room.revision;
  await check('双方确认后进入提问阶段', () => {
    assert.equal(room.phase, 'ask');
    assert.equal(room.turn, 0);
    assert.equal(room.lives[0], 3);
  });

  await check('倒计时约为 60 秒', () => {
    const remaining = room.deadline - Date.now();
    assert(remaining > 55000 && remaining < 65000, `实际 ${remaining}ms`);
  });

  await check(
    '未提问不能直接回答',
    expects(409, () =>
      act(code, HOST, { action: 'guess', text: '皮卡丘', revision: rev }, 'test'),
    ),
  );

  // 玩家0 公开提问
  room = await act(
    code,
    HOST,
    { action: 'ask', text: room.questions[0], privacy: 'public', revision: rev },
    'test',
  );
  rev = room.revision;
  await check('公开提问后进入 priority 并得到回答', () => {
    assert.equal(room.phase, 'priority');
    assert(['YES', 'NO', 'UNKNOWN'].includes(room.history.at(-1).answer));
  });
  await check('priority 阶段仍在 60 秒总预算内', () => {
    const remaining = room.deadline - Date.now();
    assert(remaining > 0 && remaining < 65000, `实际 ${remaining}ms`);
  });

  // 玩家0 保持沉默，轮到玩家1
  room = await act(code, HOST, { action: 'pass', revision: rev }, 'test');
  rev = room.revision;
  await check('保持沉默后交换回合', () => {
    assert.equal(room.turn, 1);
    assert.equal(room.phase, 'ask');
  });

  // 玩家1 秘密提问：本人可见、对方不可见
  room = await act(
    code,
    GUEST,
    {
      action: 'ask',
      text: room.questions[1],
      privacy: 'private-question',
      revision: rev,
    },
    'test',
  );
  rev = room.revision;
  const privateQuestion = room.history.find(
    (event) => event.kind === 'ask' && event.privacy === 'private-question',
  );
  await check('秘密提问本人可见', () => assert(privateQuestion));
  await check('秘密提问标记技能已使用', () => {
    assert.equal(room.abilities[1].privateQuestion, false);
  });
  const otherView = await getRoom(code, HOST);
  await check('秘密提问对方不可见', () => {
    assert.equal(
      otherView.history.some((event) => event.id === privateQuestion.id),
      false,
    );
  });

  // 玩家1 保持沉默，轮到玩家0
  room = await act(code, GUEST, { action: 'pass', revision: rev }, 'test');
  rev = room.revision;

  // 玩家0 秘密回答：问题双方可见，答案仅本人可见
  room = await act(
    code,
    HOST,
    {
      action: 'ask',
      text: room.questions[2],
      privacy: 'private-answer',
      revision: rev,
    },
    'test',
  );
  rev = room.revision;
  const privateAnswer = room.history.find(
    (event) => event.kind === 'ask' && event.privacy === 'private-answer',
  );
  await check('秘密回答本人可见完整问答', () => {
    assert(privateAnswer);
    assert.equal(typeof privateAnswer.answer, 'string');
  });
  const rivalView = await getRoom(code, GUEST);
  const rivalEvent = rivalView.history.find(
    (event) => event.id === privateAnswer.id,
  );
  await check('秘密回答对方只能看到问题、看不到答案', () => {
    assert.equal(rivalEvent.text, privateAnswer.text);
    assert.equal(rivalEvent.answer, undefined);
    assert.equal(rivalEvent.answerHidden, true);
  });

  // 玩家0 答错扣命，交换回合
  room = await act(
    code,
    HOST,
    { action: 'guess', text: '绝对不存在的角色', revision: rev },
    'test',
  );
  rev = room.revision;
  await check('答错扣一条命并交换回合', () => {
    assert.equal(room.lives[0], 2);
    assert.equal(room.turn, 1);
  });

  // 双方轮流答错，直到有人归零
  let guard = 0;
  while (room.phase !== 'finished' && guard < 60) {
    guard++;
    const player = room.turn === 0 ? HOST : GUEST;
    const asked = await act(
      code,
      player,
      {
        action: 'ask',
        text: room.questions[0],
        privacy: 'public',
        revision: rev,
      },
      'test',
    );
    rev = asked.revision;
    room = await act(
      code,
      player,
      { action: 'guess', text: '绝对不存在的角色', revision: rev },
      'test',
    );
    rev = room.revision;
  }
  await check('命数归零后判负，对方不战而胜', () => {
    assert.equal(room.phase, 'finished');
    assert.equal(room.winReason, 'out-of-lives');
    assert.equal(room.lives[1 - room.winner], 0);
    assert(room.answer, '结算后应揭示谜底');
  });

  // 再来一局重置（需双方都确认）
  room = await act(code, HOST, { action: 'restart', revision: rev }, 'test');
  rev = room.revision;
  await check('单人再来一局仍等待对方', () => {
    assert.equal(room.phase, 'finished');
    assert.deepEqual(room.ready, [0]);
  });
  room = await act(code, GUEST, { action: 'restart', revision: rev }, 'test');
  rev = room.revision;
  await check('双方都确认后重置生命与技能', () => {
    assert.equal(room.phase, 'briefing');
    assert.deepEqual(room.lives, [3, 3]);
    assert.equal(room.abilities[0].privateQuestion, true);
    assert.equal(room.abilities[1].privateAnswer, true);
  });
})();

// —— 超时自动轮转（把超时缩短到 400ms 加速验证）——
await (async () => {
  const prev = process.env.TURN_TIMEOUT_MS;
  process.env.TURN_TIMEOUT_MS = '400';
  try {
    const m = await createRoom('timeout-host', 'A', 'pokemon-151', 'test');
    let r = await act(
      m.code,
      'timeout-guest',
      { action: 'join', name: 'B' },
      'test',
    );
    r = await act(
      m.code,
      'timeout-host',
      { action: 'start', revision: r.revision },
      'test',
    );
    r = await act(
      m.code,
      'timeout-host',
      { action: 'ready', revision: r.revision },
      'test',
    );
    r = await act(
      m.code,
      'timeout-guest',
      { action: 'ready', revision: r.revision },
      'test',
    );
    const before = r.turn;
    await new Promise((resolve) => setTimeout(resolve, 700));
    const after = await getRoom(m.code, 'timeout-host');
    await check('提问超时自动交换回合', () => {
      assert.equal(after.turn, 1 - before);
      assert.equal(after.history.at(-1).kind, 'timeout');
    });
  } finally {
    if (prev === undefined) delete process.env.TURN_TIMEOUT_MS;
    else process.env.TURN_TIMEOUT_MS = prev;
  }
})();

// —— AI 模式冒烟（有密钥时才执行）——
if (aiReady()) {
  await (async () => {
    const m = await createRoom('ai-host', 'A', 'overwatch', 'test');
    let r = await act(
      m.code,
      'ai-guest',
      { action: 'join', name: 'B' },
      'test',
    );
    r = await act(
      m.code,
      'ai-host',
      { action: 'start', revision: r.revision },
      'test',
    );
    r = await act(
      m.code,
      'ai-host',
      { action: 'ready', revision: r.revision },
      'test',
    );
    r = await act(
      m.code,
      'ai-guest',
      { action: 'ready', revision: r.revision },
      'test',
    );
    const asked = await act(
      m.code,
      'ai-host',
      {
        action: 'ask',
        text: '这个角色是支援定位吗？',
        privacy: 'public',
        revision: r.revision,
      },
      'test',
    );
    await check('AI 模式能给出三态回答', () => {
      assert.equal(asked.mode, 'ai');
      assert(['YES', 'NO', 'UNKNOWN'].includes(asked.history.at(-1).answer));
    });
  })();
} else {
  results.push({ name: 'AI 模式冒烟（跳过，未配置密钥）', ok: true });
}

const failed = results.filter((result) => !result.ok);
console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      total: results.length,
      failed: failed.length,
      results,
    },
    null,
    2,
  ),
);
process.exit(failed.length ? 1 : 0);
