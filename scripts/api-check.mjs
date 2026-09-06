import assert from 'node:assert/strict';

const origin = process.env.TEST_ORIGIN || 'http://localhost:3000';
function player() {
  let cookie = '';
  return async (path, body) => {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        origin,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const nextCookie = response.headers.get('set-cookie');
    if (nextCookie) cookie = nextCookie.split(';')[0];
    return { status: response.status, data: await response.json() };
  };
}
const waitPast = async (deadline) => {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, deadline - Date.now()) + 350),
  );
};

const host = player();
const guest = player();
const outsider = player();
const made = await host('/api/rooms', {
  name: 'ATA',
  category: 'pokemon-151',
});
assert.equal(made.status, 200);
assert.equal(made.data.mode, 'demo');
assert.equal(made.data.category, 'pokemon-151');
const path = '/api/rooms/' + made.data.code;
assert.equal((await outsider(path)).status, 403);

const joined = await guest(path, { action: 'join', name: 'RIVAL' });
assert.equal(joined.status, 200);
assert.equal(joined.data.players.length, 2);
assert.equal(
  (await guest(path, { action: 'start', revision: joined.data.revision }))
    .status,
  403,
);
let room = (
  await host(path, { action: 'start', revision: joined.data.revision })
).data;
assert.equal(room.phase, 'briefing');
assert.equal(room.deadline, null);
assert.notEqual(room.players[0].avatar, room.players[1].avatar);
room = (await host(path, { action: 'ready', revision: room.revision })).data;
assert.equal(room.phase, 'briefing');
room = (await guest(path, { action: 'ready', revision: room.revision })).data;
assert.equal(room.phase, 'ask');
assert.equal(room.lives[0], 3);
assert.equal(room.abilities[0].privateQuestion, true);
assert(room.deadline > Date.now());
assert.equal('secret' in room, false);
assert.equal(
  (
    await host(path, {
      action: 'guess',
      text: '猎空',
      revision: room.revision,
    })
  ).status,
  409,
  'Guess requires Ask first',
);
room = (
  await host(path, {
    action: 'ask',
    text: room.questions[0],
    privacy: 'public',
    revision: room.revision,
  })
).data;
assert.equal(room.phase, 'priority');
assert(['YES', 'NO', 'UNKNOWN'].includes(room.history.at(-1).answer));
let otherView = (await guest(path)).data;
assert.equal(otherView.history.at(-1).text, room.history.at(-1).text);
assert.equal(otherView.history.at(-1).answer, room.history.at(-1).answer);
room = (await host(path, { action: 'pass', revision: room.revision })).data;

room = (
  await guest(path, {
    action: 'ask',
    text: room.questions[1],
    privacy: 'private-question',
    revision: room.revision,
  })
).data;
assert.equal(room.abilities[1].privateQuestion, false);
const privateQuestionId = room.history.at(-1).id;
const privateQuestion = room.history.find(
  (event) => event.kind === 'ask' && event.privacy === 'private-question',
);
assert(privateQuestion);
assert.equal(room.history.at(-1).text, 'PRIVATE_QUESTION_USED');
otherView = (await host(path)).data;
assert.equal(
  otherView.history.some((event) => event.id === privateQuestion.id),
  false,
  'Private Question is absent for the opponent',
);
assert.equal(
  otherView.history.some(
    (event) => event.kind === 'notice' && event.id === privateQuestionId,
  ),
  true,
  'Private Question usage notice is public',
);
room = (await guest(path, { action: 'pass', revision: room.revision })).data;

room = (
  await host(path, {
    action: 'ask',
    text: room.questions[2],
    privacy: 'private-answer',
    revision: room.revision,
  })
).data;
assert.equal(room.abilities[0].privateAnswer, false);
const privateAnswer = room.history.find(
  (event) => event.kind === 'ask' && event.privacy === 'private-answer',
);
assert(privateAnswer);
const privateAnswerId = privateAnswer.id;
assert.equal(room.history.at(-1).text, 'PRIVATE_ANSWER_USED');
otherView = (await guest(path)).data;
const hiddenAnswer = otherView.history.find(
  (event) => event.id === privateAnswerId,
);
assert.equal(hiddenAnswer.text, privateAnswer.text);
assert.equal(hiddenAnswer.answer, undefined);
assert.equal(hiddenAnswer.answerHidden, true);
room = (
  await host(path, {
    action: 'guess',
    text: '绝对不存在的英雄',
    revision: room.revision,
  })
).data;
assert.equal(room.lives[0], 2);
assert.equal(room.turn, 1);

room = (
  await guest(path, {
    action: 'ask',
    text: '这名英雄看起来很酷吗？',
    privacy: 'public',
    revision: room.revision,
  })
).data;
assert.equal(room.history.at(-1).answer, 'UNKNOWN');
room = (await guest(path, { action: 'pass', revision: room.revision })).data;

const askTurn = room.turn;
await waitPast(room.deadline);
room = (await guest(path)).data;
assert.equal(room.turn, 1 - askTurn);
assert.equal(room.history.at(-1).kind, 'timeout');
assert.equal(room.history.at(-1).text, 'ASK_TIMEOUT');

const active = room.turn === 0 ? host : guest;
room = (
  await active(path, {
    action: 'ask',
    text: room.questions[3],
    privacy: 'public',
    revision: room.revision,
  })
).data;
const decidingPlayer = room.turn;
await waitPast(room.deadline);
room = (await host(path)).data;
assert.equal(room.turn, 1 - decidingPlayer);
assert.equal(room.history.at(-1).text, 'DECISION_TIMEOUT');

while (room.phase !== 'finished') {
  const current = room.turn === 0 ? host : guest;
  const player = room.turn;
  room = (
    await current(path, {
      action: 'ask',
      text: room.questions[4],
      privacy: 'public',
      revision: room.revision,
    })
  ).data;
  if (player === 0) {
    room = (
      await current(path, {
        action: 'guess',
        text: '绝对不存在的英雄',
        revision: room.revision,
      })
    ).data;
  } else {
    room = (await current(path, { action: 'pass', revision: room.revision }))
      .data;
  }
}
assert.equal(room.lives[0], 0);
assert.equal(room.winner, 1);
assert.equal(room.winReason, 'out-of-lives');
assert.equal(room.players[0].losses, 1);
assert.equal(room.players[1].wins, 1);
assert(room.answer);

const firstReady = await host(path, {
  action: 'restart',
  revision: room.revision,
});
assert.equal(firstReady.status, 200);
const restarted = await guest(path, {
  action: 'restart',
  revision: firstReady.data.revision,
});
assert.equal(restarted.status, 200);
assert.equal(restarted.data.phase, 'briefing');
assert.deepEqual(restarted.data.lives, [3, 3]);
assert.equal(restarted.data.abilities[0].privateQuestion, true);
assert.equal(restarted.data.abilities[1].privateAnswer, true);
assert.equal(restarted.data.turn, 1);
assert.equal(restarted.data.deadline, null);
let resumed = (
  await host(path, { action: 'ready', revision: restarted.data.revision })
).data;
resumed = (await guest(path, { action: 'ready', revision: resumed.revision }))
  .data;
assert.equal(resumed.phase, 'ask');
assert(resumed.deadline > Date.now());

console.log(
  JSON.stringify({
    ok: true,
    room: made.data.code,
    publicAnswers: true,
    privateQuestion: true,
    privateAnswer: true,
    unknownConsumesTurn: true,
    askTimeout: true,
    decisionTimeout: true,
    threeLivesLoseAtZero: true,
    briefingReady: true,
    categorySelection: true,
    publicSecretUseNotices: true,
    rematchReset: true,
  }),
);
