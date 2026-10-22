'use strict';
/**
 * 규칙 · 예외 상황 하나하나 — node test/rules.js
 * 사람 자리만으로 판을 만들고(봇 타이머가 끼지 않게) 손패 · 벌칙 더미를 직접 정한 뒤 메시지를 보내 확인한다.
 */
process.env.ROACH_FAST = '1';
const assert = require('assert');
const R = require('../rules');
const G = require('../game');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const REVEAL = 90;        // FAST 에서 뒤집기 40ms — 넉넉히

class Fake {
  constructor() { this.readyState = 1; this.msgs = []; this.last = null; this.errs = []; }
  send(t) { const m = JSON.parse(t); this.msgs.push(m); if (m.t === 'state') this.last = m; if (m.t === 'err') this.errs.push(m.msg); }
  close() { this.readyState = 3; }
}

let nextId = 1000;
const card = (k, r) => ({ id: nextId++, k, ...(r ? { r: true } : {}) });

/** n 명 사람 자리 방 — 시작까지 */
function table(ed, n) {
  const ws = Array.from({ length: n }, () => new Fake());
  G.handle(ws[0], { t: 'create', name: 'P1' });
  const code = ws[0].msgs.find(m => m.t === 'welcome').code;
  for (let i = 1; i < n; i++) G.handle(ws[i], { t: 'join', code, name: 'P' + (i + 1) });
  G.handle(ws[0], { t: 'cfg', edition: ed, turnLimit: 0 });
  G.handle(ws[0], { t: 'start' });
  const room = G.rooms.get(code);
  const ps = room.players;
  const send = (i, m) => G.handle(ws[i], m);
  /** 손패 · 벌칙 더미 · 내밀 사람을 정한다 (앞줄은 비운다) */
  const setup = (hands, penalty = [], starter = 0) => {
    ps.forEach((p, i) => { p.hand = hands[i] || []; p.row = R.emptyRow(ed); p.crowns = {}; });
    room.penalty = penalty;
    room.starter = ps[starter].id;
    room.chain = null; room.tribute = null; room.pendingTrib = [];
  };
  const done = () => { for (const w of ws) G.handle(w, { t: 'leave' }); };
  return { ws, room, ps, send, setup, done, code };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ── 말이 맞나 ── */
test('말 판정표 — 생물 · 아니야 · 왕 · 신하 · 검은 카드', () => {
  const T = (c, cl) => R.truthOf(c, cl);
  assert.strictEqual(T({ k: 'toad' }, 'toad'), true);
  assert.strictEqual(T({ k: 'toad' }, 'bat'), false);
  assert.strictEqual(T({ k: 'toad' }, '!toad'), false);
  assert.strictEqual(T({ k: 'toad' }, '!bat'), true);
  assert.strictEqual(T({ k: 'bat', r: true }, 'bat'), true);
  assert.strictEqual(T({ k: 'bat', r: true }, 'royal'), true);
  assert.strictEqual(T({ k: 'bat', r: true }, 'toad'), false);
  assert.strictEqual(T({ k: 'bat', r: true }, '!royal'), false);
  assert.strictEqual(T({ k: 'bat' }, 'royal'), false);
  assert.strictEqual(T({ k: 'bat' }, '!royal'), true);
  assert.strictEqual(T({ k: 'subject' }, 'toad'), true);
  assert.strictEqual(T({ k: 'subject' }, 'royal'), false);
  assert.strictEqual(T({ k: 'subject' }, '!royal'), true);
  assert.strictEqual(T({ k: 'subject' }, '!toad'), false);
  for (const cl of ['toad', 'royal', '!toad', '!royal']) assert.strictEqual(T({ k: 'black' }, cl), false, `검은 카드 ${cl}`);
});

test('나누기 — 판 · 인원마다 카드 수와 몫', () => {
  for (const ed of R.EDITIONS) for (let n = 2; n <= 6; n++) {
    const deck = R.makeDeck(ed);
    const d = R.deal(deck, n, ed);
    const sum = d.hands.reduce((a, h) => a + h.length, 0) + d.penalty.length + d.removed.length;
    assert.strictEqual(sum, deck.length);
    const lens = d.hands.map(h => h.length);
    assert.ok(Math.max(...lens) - Math.min(...lens) <= 1, `${ed} ${n}인 몫 ${lens}`);
    if (ed === 'royal') {
      assert.ok(d.penalty.length >= (n === 2 ? 16 : 7));
      assert.ok(lens[0] >= lens[lens.length - 1], '남는 장은 첫 사람');
      assert.strictEqual(d.removed.length, 0);
    } else {
      assert.strictEqual(d.penalty.length, 0);
      assert.strictEqual(d.removed.length, n === 2 ? 10 : 0);
    }
    assert.strictEqual(R.loseAt(ed, n), n === 2 ? 5 : 4);
    assert.strictEqual(R.canPass(ed, n), n > 2);
  }
  assert.strictEqual(R.makeDeck('base').length, 64);
  assert.strictEqual(R.makeDeck('royal').length, 65);
});

/* ── 기본 흐름 ── */
test('맞히면 내민 사람이, 틀리면 받은 사람이 가져가고 그 사람이 다음에 내민다', async () => {
  const t = table('base', 3);
  const toad = card('toad');
  t.setup([[toad, card('bat')], [card('rat')], [card('fly')]]);
  t.send(0, { t: 'give', card: toad.id, to: t.ps[1].id, claim: 'toad' });
  assert.ok(t.room.chain && t.room.chain.to === t.ps[1].id);
  t.send(1, { t: 'call', sayTrue: true });            // 진짜 — 맞혔다
  assert.ok(t.room.reveal && t.room.reveal.right && t.room.reveal.taker === t.ps[0].id);
  await sleep(REVEAL);
  assert.strictEqual(t.ps[0].row.toad, 1);
  assert.strictEqual(t.room.starter, t.ps[0].id);

  const bat = t.ps[0].hand.find(c => c.k === 'bat');
  t.send(0, { t: 'give', card: bat.id, to: t.ps[2].id, claim: 'fly' });
  t.send(2, { t: 'call', sayTrue: true });            // 거짓말인데 믿었다 — 틀렸다
  assert.ok(!t.room.reveal.right && t.room.reveal.taker === t.ps[2].id);
  await sleep(REVEAL);
  assert.strictEqual(t.ps[2].row.bat, 1);
  assert.strictEqual(t.room.starter, t.ps[2].id);
  t.done();
});

test('“아니야” 말 — 거짓말이라고 맞히면 내민 사람이 가져간다', async () => {
  const t = table('base', 3);
  const toad = card('toad');
  t.setup([[toad, card('bat')], [card('rat')], [card('fly')]]);
  t.send(0, { t: 'give', card: toad.id, to: t.ps[1].id, claim: '!toad' });
  assert.strictEqual(t.room.chain.claim, '!toad');
  t.send(1, { t: 'call', sayTrue: false });
  assert.ok(t.room.reveal.right && !t.room.reveal.truth);
  await sleep(REVEAL);
  assert.strictEqual(t.ps[0].row.toad, 1);
  t.done();
});

test('엉뚱한 메시지는 무시 — 남의 차례 · 없는 카드 · 나에게 · 이상한 말', () => {
  const t = table('base', 3);
  const toad = card('toad');
  t.setup([[toad, card('bat')], [card('rat')], [card('fly')]]);
  t.send(1, { t: 'give', card: t.ps[1].hand[0].id, to: t.ps[2].id, claim: 'rat' });   // 내 차례 아님
  t.send(0, { t: 'give', card: 99999, to: t.ps[1].id, claim: 'rat' });               // 없는 카드
  t.send(0, { t: 'give', card: toad.id, to: t.ps[0].id, claim: 'rat' });             // 나에게
  t.send(0, { t: 'give', card: toad.id, to: t.ps[1].id, claim: 'royal' });           // 기본판엔 “왕” 없음
  t.send(0, { t: 'give', card: toad.id, to: t.ps[1].id, claim: '!!toad' });
  t.send(0, { t: 'call', sayTrue: true });                                           // 받은 사람 아님
  assert.strictEqual(t.room.chain, null);
  assert.strictEqual(t.ps[0].hand.length, 2);
  t.done();
});

test('몰래 보고 넘기기 — 본 사람에게는 못 넘기고, 모두 봤으면 넘기기 불가', async () => {
  const t = table('base', 3);
  const toad = card('toad');
  t.setup([[toad], [card('rat')], [card('fly')]]);
  t.send(0, { t: 'give', card: toad.id, to: t.ps[1].id, claim: 'bat' });
  t.send(1, { t: 'peek' });
  assert.strictEqual(t.room.chain.step, 'pass');
  assert.deepStrictEqual(t.ws[1].last.chain.card, { k: 'toad', r: false }, '본 사람에게는 정체가 보인다');
  assert.strictEqual(t.ws[2].last.chain.card, null, '안 본 사람에게는 안 보인다');
  t.send(1, { t: 'call', sayTrue: true });                     // 본 뒤엔 외칠 수 없다
  assert.strictEqual(t.room.reveal, null);
  t.send(1, { t: 'pass', to: t.ps[0].id, claim: 'rat' });      // 처음 사람은 이미 봤다
  assert.strictEqual(t.room.chain.to, t.ps[1].id);
  t.send(1, { t: 'pass', to: t.ps[2].id, claim: '!rat' });
  assert.strictEqual(t.room.chain.to, t.ps[2].id);
  assert.strictEqual(t.room.chain.from, t.ps[1].id);
  assert.strictEqual(t.room.chain.path.length, 2);
  t.send(2, { t: 'peek' });                                     // 남은 사람이 없다
  assert.ok(t.ws[2].errs.length, '넘기기 불가 안내');
  assert.strictEqual(t.room.chain.step, 'decide');
  t.send(2, { t: 'call', sayTrue: false });                     // "쥐가 아니야" → 거짓말이라고 → 사실 두꺼비라 쥐가 아닌 게 맞다 → 틀렸다
  assert.ok(!t.room.reveal.right);
  assert.strictEqual(t.room.reveal.passer, t.ps[1].id);
  await sleep(REVEAL);
  assert.strictEqual(t.ps[2].row.toad, 1);
  t.done();
});

test('2인 — 두 판 모두 넘기기 없음', () => {
  for (const ed of R.EDITIONS) {
    const t = table(ed, 2);
    const c = card('toad');
    t.setup([[c, card('rat')], [card('fly')]]);
    t.send(0, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
    assert.deepStrictEqual(t.room.chain.targets || [], []);
    assert.strictEqual(t.ws[1].last.chain.targets.length, 0);
    assert.strictEqual(t.ws[1].last.canPass, false);
    t.send(1, { t: 'peek' });
    assert.strictEqual(t.room.chain.step, 'decide');
    assert.strictEqual(t.room.loseAt, 5);
    t.done();
  }
});

/* ── 지는 조건 ── */
test('같은 생물 4장이 쌓이면 진다 (왕도 그 생물로 센다)', async () => {
  const t = table('royal', 3);
  const kb = card('bat', true);
  t.setup([[kb, card('rat')], [card('rat')], [card('fly')]], [card('fly')]);
  t.ps[1].row.bat = 3;
  t.send(0, { t: 'give', card: kb.id, to: t.ps[1].id, claim: 'royal' });
  t.send(1, { t: 'call', sayTrue: false });            // 왕 맞는데 거짓말이라 했다 → 틀림 → 받은 사람이 가져감
  await sleep(REVEAL);
  assert.strictEqual(t.room.phase, 'over');
  assert.strictEqual(t.room.loser, t.ps[1].id);
  assert.strictEqual(t.room.loseWhy, 'four');
  assert.strictEqual(t.room.loseKind, 'bat');
  t.done();
});

test('2인은 5장이 되어야 진다', async () => {
  const t = table('base', 2);
  const b1 = card('bat'), b2 = card('bat');
  t.setup([[b1, b2, card('rat')], [card('fly')]]);
  t.ps[1].row.bat = 3;
  t.send(0, { t: 'give', card: b1.id, to: t.ps[1].id, claim: 'rat' });
  t.send(1, { t: 'call', sayTrue: true });             // 틀렸다 → 4장째
  await sleep(REVEAL);
  assert.strictEqual(t.room.phase, 'playing', '4장으로는 안 진다');
  assert.strictEqual(t.ps[1].row.bat, 4);
  // 이제 P2 가 내민다 — 다시 박쥐를 떠안게 해 보자
  const f = t.ps[1].hand[0];
  t.send(1, { t: 'give', card: f.id, to: t.ps[0].id, claim: 'fly' });
  t.send(0, { t: 'call', sayTrue: true });             // 맞혔다 → P2 가 파리를 가져감
  await sleep(REVEAL);
  assert.strictEqual(t.ps[1].row.fly, 1);
  t.done();
});

test('내밀 차례인데 손이 비면 진다', async () => {
  const t = table('base', 3);
  const last = card('toad');
  t.setup([[last], [card('rat')], [card('fly')]]);
  t.send(0, { t: 'give', card: last.id, to: t.ps[1].id, claim: 'toad' });
  t.send(1, { t: 'call', sayTrue: true });             // 맞혔다 → 빈손 P1 이 가져가고 내밀 차례
  await sleep(REVEAL);
  assert.strictEqual(t.room.phase, 'over');
  assert.strictEqual(t.room.loser, t.ps[0].id);
  assert.strictEqual(t.room.loseWhy, 'empty');
  t.done();
});

test('손이 빈 사람도 카드를 받고 넘길 수 있다 — 내밀 차례가 와야 진다', async () => {
  const t = table('base', 3);
  const c = card('toad');
  t.setup([[c, card('rat')], [], [card('fly')]]);
  t.send(0, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
  t.send(1, { t: 'peek' });
  t.send(1, { t: 'pass', to: t.ps[2].id, claim: 'toad' });
  t.send(2, { t: 'call', sayTrue: true });             // 맞혔다 → 넘긴 P2(빈손) 가 가져가고 내밀 차례 → 진다
  await sleep(REVEAL);
  assert.strictEqual(t.room.loser, t.ps[1].id);
  assert.strictEqual(t.room.loseWhy, 'empty');
  t.done();
});

/* ── 로얄 ── */
test('왕을 펼치면 벌칙 더미 윗장도 — 또 왕이면 한 장 더, 새 윗장이 보인다', async () => {
  const t = table('royal', 3);
  const kb = card('bat', true);
  const kt = card('toad', true), fly = card('fly'), under = card('rat');
  t.setup([[kb, card('rat')], [card('rat')], [card('fly')]], [under, fly, kt]);   // 맨 끝이 윗장
  assert.deepStrictEqual(t.ws[0].last.penalty === null ? null : 'x', 'x');
  t.send(0, { t: 'give', card: kb.id, to: t.ps[1].id, claim: 'bat' });
  t.send(1, { t: 'call', sayTrue: false });
  await sleep(REVEAL);
  const p = t.ps[1];
  assert.strictEqual(p.row.bat, 1);
  assert.strictEqual(p.row.toad, 1, '윗장 왕 두꺼비');
  assert.strictEqual(p.row.fly, 1, '또 왕이라 한 장 더');
  assert.strictEqual(p.row.rat, 0, '왕이 아니면 멈춘다');
  assert.deepStrictEqual(p.crowns, { bat: 1, toad: 1 });
  assert.strictEqual(t.room.penalty.length, 1);
  assert.deepStrictEqual(t.ws[0].last.penalty.top, { k: 'rat', r: false });
  assert.strictEqual(t.room.fx.cards.filter(c => c.src === 'penalty').length, 2);
  t.done();
});

test('벌칙 더미가 바닥이면 왕을 펼쳐도 더 가져오지 않는다', async () => {
  const t = table('royal', 3);
  const kb = card('bat', true);
  t.setup([[kb, card('rat')], [card('rat')], [card('fly')]], []);
  t.send(0, { t: 'give', card: kb.id, to: t.ps[1].id, claim: 'bat' });
  t.send(1, { t: 'call', sayTrue: false });
  await sleep(REVEAL);
  assert.strictEqual(t.ps[1].row.bat, 1);
  assert.strictEqual(t.room.phase, 'playing');
  assert.strictEqual(t.ws[0].last.penalty.top, null);
  t.done();
});

test('검은 카드를 떠안으면 손으로 — 맞는 1장이나 아무 2장을 내려놓는다', async () => {
  const t = table('royal', 3);
  const black = card('black');
  const rat = card('rat'), toad = card('toad'), fly = card('fly');
  t.setup([[black, card('bat')], [rat, toad, fly], [card('fly')]], [card('stink')]);
  t.send(0, { t: 'give', card: black.id, to: t.ps[1].id, claim: 'rat' });
  t.send(1, { t: 'call', sayTrue: true });             // 검은 카드는 늘 틀린다 → 믿은 P2 가 떠안는다
  await sleep(REVEAL);
  const p = t.ps[1];
  assert.ok(t.room.tribute && t.room.tribute.who === p.id && t.room.tribute.claim === 'rat');
  assert.ok(p.hand.some(c => c.k === 'black'), '손으로 들어왔다');
  t.send(1, { t: 'tribute', ids: [toad.id] });         // 쥐가 아닌 1장 — 안 된다
  assert.ok(t.room.tribute, '맞지 않는 1장은 거절');
  t.send(1, { t: 'tribute', ids: [black.id] });        // 특수 카드는 못 낸다
  assert.ok(t.room.tribute);
  t.send(1, { t: 'tribute', ids: [rat.id] });          // 쥐 1장 — 된다
  assert.strictEqual(t.room.tribute, null);
  assert.strictEqual(p.row.rat, 1);
  assert.strictEqual(t.room.starter, p.id);
  t.done();
});

test('특수 카드 값 — 맞는 카드가 없으면 아무 2장, 손에 낼 카드가 없으면 그냥 넘어간다', async () => {
  const t = table('royal', 3);
  const sub = card('subject');
  const a = card('toad'), b = card('fly');
  t.setup([[sub, card('bat')], [a, b], [card('fly')]], [card('stink')]);
  t.send(0, { t: 'give', card: sub.id, to: t.ps[1].id, claim: 'royal' });
  t.send(1, { t: 'call', sayTrue: true });             // 신하는 “왕” 에 틀린다 → 믿은 P2 가 떠안는다
  await sleep(REVEAL);
  assert.ok(t.room.tribute);
  t.send(1, { t: 'tribute', ids: [a.id, b.id] });
  assert.strictEqual(t.room.tribute, null);
  assert.strictEqual(t.ps[1].row.toad + t.ps[1].row.fly, 2);

  const t2 = table('royal', 3);
  const bl = card('black');
  t2.setup([[bl, card('bat')], [card('subject')], [card('fly')]], [card('stink')]);
  t2.send(0, { t: 'give', card: bl.id, to: t2.ps[1].id, claim: 'rat' });
  t2.send(1, { t: 'call', sayTrue: true });
  await sleep(REVEAL);
  assert.strictEqual(t2.room.tribute, null, '낼 카드가 없으면 바로 넘어간다');
  assert.strictEqual(t2.room.starter, t2.ps[1].id);
  assert.strictEqual(t2.room.phase, 'playing', '손에 특수 카드 두 장이 있으니 빈손이 아니다');
  t.done(); t2.done();
});

test('값으로 낸 왕도 벌칙 더미를 부르고, 벌칙 더미에서 나온 특수 카드도 값을 치른다', async () => {
  const t = table('royal', 3);
  const bl = card('black');
  const kr = card('rat', true), x = card('toad'), y = card('fly');
  const sub = card('subject');
  t.setup([[bl, card('bat')], [kr, x, y], [card('fly')]], [card('stink'), sub]);   // 윗장 = 신하
  t.send(0, { t: 'give', card: bl.id, to: t.ps[1].id, claim: 'rat' });
  t.send(1, { t: 'call', sayTrue: true });
  await sleep(REVEAL);
  t.send(1, { t: 'tribute', ids: [kr.id] });            // 왕 쥐는 “쥐” 에 맞다
  const p = t.ps[1];
  assert.strictEqual(p.row.rat, 1);
  assert.ok(p.hand.some(c => c.k === 'subject'), '벌칙 더미의 신하가 손으로');
  assert.ok(t.room.tribute && t.room.tribute.fromPenalty, '그 값도 치른다');
  t.send(1, { t: 'tribute', ids: [x.id, y.id] });
  assert.strictEqual(t.room.tribute, null);
  assert.strictEqual(t.room.starter, p.id);
  t.done();
});

/* ── 사람이 빠질 때 ── */
test('판 중에 나가면 봇이 이어받아 판이 멈추지 않는다', async () => {
  const t = table('base', 3);
  const c = card('toad');
  t.setup([[c, card('rat')], [card('rat'), card('bat')], [card('fly'), card('fly')]]);
  t.send(0, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
  t.send(1, { t: 'leave' });
  assert.ok(t.ps[1].bot && / \(봇\)$/.test(t.ps[1].name));
  await sleep(150);
  assert.ok(t.room.reveal || t.room.chain === null || t.room.chain.to !== t.ps[1].id, '봇이 대신 두었다');
  // 방장이 나가도 다른 사람이 방장
  t.send(0, { t: 'leave' });
  assert.strictEqual(t.room.hostId, t.ps[2].id);
  t.done();
});

test('끊긴 사람 차례는 잠깐 기다렸다가 대신 두고, 돌아오면 손패가 그대로', async () => {
  const t = table('base', 3);
  const c = card('toad');
  t.setup([[c, card('rat')], [card('rat'), card('bat')], [card('fly')]]);
  const token = t.ws[1].msgs.find(m => m.t === 'welcome').token;
  t.send(0, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
  G.disconnect(t.ws[1]);
  assert.strictEqual(t.ps[1].connected, false);
  await sleep(400);                                     // FAST 에서 6초 → 0.2초
  assert.ok(t.room.reveal || !t.room.chain || t.room.chain.to !== t.ps[1].id, '대신 두었다');
  const back = new Fake();
  G.handle(back, { t: 'resume', code: t.code, token });
  assert.strictEqual(back.last.you, t.ps[1].id);
  assert.strictEqual(back.last.hand.length, t.ps[1].hand.length);
  t.ws[1] = back;
  t.done();
});

test('관전자는 판에 손댈 수 없고, 카드 정체를 받지 않는다', () => {
  const t = table('base', 3);
  const sp = new Fake();
  G.handle(sp, { t: 'join', code: t.code, name: '구경' });
  assert.strictEqual(sp.last.role, 'spec');
  const c = card('toad');
  t.setup([[c, card('rat')], [card('rat')], [card('fly')]]);
  G.handle(sp, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
  assert.strictEqual(t.room.chain, null);
  t.send(0, { t: 'give', card: c.id, to: t.ps[1].id, claim: 'toad' });
  assert.strictEqual(sp.last.chain.card, null);
  assert.deepStrictEqual(sp.last.hand, []);
  G.handle(sp, { t: 'leave' });
  t.done();
});

test('한 판 더 — 대기실로 돌아가고 앞줄 · 손패가 비며, 나가서 봇이 된 자리는 빠진다', async () => {
  const t = table('base', 3);
  const last = card('toad');
  t.setup([[last], [card('rat')], [card('fly')]]);
  t.send(2, { t: 'leave' });                           // 봇이 됨
  t.send(0, { t: 'give', card: last.id, to: t.ps[1].id, claim: 'toad' });
  t.send(1, { t: 'call', sayTrue: true });
  await sleep(REVEAL);
  assert.strictEqual(t.room.phase, 'over');
  t.send(0, { t: 'again' });
  assert.strictEqual(t.room.phase, 'lobby');
  assert.strictEqual(t.room.players.length, 2);
  assert.ok(t.room.players.every(p => !p.hand.length && !Object.values(p.row).some(v => v)));
  t.send(0, { t: 'start' });
  assert.strictEqual(t.room.phase, 'playing');
  assert.strictEqual(t.room.loseAt, 5, '둘만 남으면 2인 규칙');
  assert.strictEqual(t.room.removed, 10);
  t.done();
});

test('대기실 — 얼굴은 남이 쓰는 것으로 못 바꾸고, 방장만 설정 · 강퇴 · 시작', () => {
  const ws = [new Fake(), new Fake()];
  G.handle(ws[0], { t: 'create', name: 'A' });
  const code = ws[0].msgs.find(m => m.t === 'welcome').code;
  G.handle(ws[1], { t: 'join', code, name: 'B' });
  const room = G.rooms.get(code);
  const [a, b] = room.players;
  G.handle(ws[1], { t: 'face', face: a.face });
  assert.notStrictEqual(b.face, a.face);
  G.handle(ws[1], { t: 'face', face: 'spider' });
  assert.strictEqual(b.face, 'spider');
  G.handle(ws[1], { t: 'cfg', edition: 'base' });
  assert.strictEqual(room.cfg.edition, 'royal', '손님은 설정 못 함');
  G.handle(ws[1], { t: 'start' });
  assert.strictEqual(room.phase, 'lobby');
  G.handle(ws[0], { t: 'kick', id: b.id });
  assert.strictEqual(room.players.length, 1);
  G.handle(ws[0], { t: 'start' });
  assert.strictEqual(room.phase, 'lobby', '혼자는 시작 못 함');
  G.handle(ws[0], { t: 'leave' });
  assert.ok(!G.rooms.has(code), '빈 방은 치운다');
});

(async () => {
  let ok = 0;
  for (const { name, fn } of tests) {
    try { await fn(); ok++; console.log('  ✓', name); }
    catch (e) { console.log('  ✗', name); console.log(e); process.exitCode = 1; }
  }
  console.log(`${ok}/${tests.length} 통과`);
  process.exit(process.exitCode || 0);
})();
