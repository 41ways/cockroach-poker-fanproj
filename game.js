'use strict';
/**
 * 바퀴벌레 포커 — 판 진행과 방 관리.
 *  - 손패 · 오가는 카드 · 판정 · 타이머 · 봇은 전부 서버가 쥔다(권위 서버).
 *    클라이언트는 "이 카드를 저 사람에게, 박쥐라고" 만 보내고 나머지는 서버가 정한다.
 *  - 오가는 카드의 정체는 그 카드를 본 사람(넘긴 사람·몰래 본 사람)에게만 내려간다.
 *  - 통신 방식은 모른다. 소켓은 send(문자열) · close() · readyState 만 있으면 된다.
 *    Node 서버(server.js)와 Cloudflare(worker.js)가 이 파일을 똑같이 쓴다. (로보77 과 같은 짜임)
 */
const R = require('./rules');

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const MAX_SPECS = 10;
const TURN_LIMITS = [20000, 40000, 60000, 0];   // 0 = 무제한
const FAST = typeof process !== 'undefined' && !!process.env && process.env.ROACH_FAST === '1';
const REVEAL_MS = FAST ? 40 : 3400;            // 카드를 뒤집어 보여 주는 시간 — 누가 맞혔는지 읽고 카드가 날아가는 것까지
const DC_GRACE = FAST ? 200 : 6000;            // 접속 끊긴 사람 차례를 대신 두기까지
const LOBBY_GRACE = FAST ? 300 : 20_000;
const HISTORY = 14;

const BOT_NAMES = ['꼬물이', '더듬이', '까칠이', '능청이', '시치미', '뻔뻔이'];
const BOT_THINK = FAST ? [5, 20] : [1600, 3200];

/* ─────────────────────────── 유틸 ─────────────────────────── */

const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (min, max) => min + Math.random() * (max - min);
const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)),
  b => b.toString(16).padStart(2, '0')).join('');

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─────────────────────────── 방 ─────────────────────────── */

const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do code = Array.from({ length: 4 }, () => pick(alphabet.split(''))).join('');
  while (rooms.has(code));
  return code;
}

function createRoom({ priv = false, spec = true } = {}) {
  const room = {
    code: makeCode(),
    phase: 'lobby',            // lobby | playing | over
    hostId: null,
    players: [],
    specs: [],
    nextId: 1,
    cfg: { turnLimit: 40000, priv: !!priv, spec: spec !== false, edition: 'royal' },

    starter: null,             // 카드를 내밀 차례인 사람
    chain: null,               // 지금 오가는 카드 { card, from, to, claim, seen[], path[], step: 'decide' | 'pass' }
    reveal: null,              // 막 뒤집은 카드 — 잠깐 보여 준 뒤 가져갈 사람 앞에 놓인다
    tribute: null,             // 특수 카드를 떠안은 사람이 손에서 카드를 내려놓는 중 { who, claim, card }
    penalty: [],               // 로얄판 벌칙 더미 — 맨 끝 장이 펼쳐진 윗장
    fx: null, fxSeq: 0,        // 방금 누구 앞에 무엇이 놓였나 (화면 연출용)
    loseAt: 4,
    history: [],               // 지난 판정들 (화면 기록 칸)
    turnEndsAt: 0,
    loser: null, loseWhy: null, loseKind: null,
    gameNo: 0,

    timers: { turn: null, bot: null, dc: null, reveal: null, host: null },
    lastActive: Date.now(),
    madeAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

/** 자리마다 생물 얼굴을 하나씩 — 이미 쓴 얼굴은 피한다 */
function freeFace(room) {
  const used = new Set(room.players.map(p => p.face));
  return R.KINDS.find(k => !used.has(k)) || pick(R.KINDS);
}

function addPlayer(room, { name, bot }) {
  const p = {
    id: room.nextId++,
    token: token(),
    name: name || `플레이어 ${room.nextId - 1}`,
    bot: !!bot,
    ws: null,
    connected: !!bot,
    face: freeFace(room),
    hand: [],
    row: {}, crowns: {},
    lastChat: 0, lastReact: 0,
  };
  room.players.push(p);
  if (!p.bot && room.hostId == null) room.hostId = p.id;
  return p;
}

const playerOf = (room, id) => room.players.find(p => p.id === id) || null;

function pickHost(room) {
  const next = room.players.find(p => !p.bot && p.connected) || room.players.find(p => !p.bot);
  room.hostId = next ? next.id : null;
}

/** 대기실에서 자리를 뺀다. 판 중에는 빼지 않고 봇이 이어받는다(카드가 사라지면 판이 성립하지 않는다). */
function removePlayer(room, id) {
  const i = room.players.findIndex(p => p.id === id);
  if (i < 0) return;
  const p = room.players[i];
  clearTimeout(p.leaveT);
  if (room.phase === 'playing') {
    p.bot = true; p.ws = null; p.connected = true; p.stood = true;   // 사람이 떠나 봇이 이어받은 자리
    p.name = p.name.replace(/ \(봇\)$/, '') + ' (봇)';
    if (room.hostId === p.id) pickHost(room);
    nudge(room);                       // 이 사람 차례였으면 봇이 이어서 둔다
    if (!room.players.some(x => !x.bot)) { /* 사람이 없으면 sweep 이 치운다 */ }
  } else {
    room.players.splice(i, 1);
    if (room.hostId === p.id) pickHost(room);
  }
  listChanged();
  seatSpecs(room);
}

/* ─────────────────────────── 관전자 (로보77 과 같다) ─────────────────────────── */

const specOf = (room, ws) => room.specs.find(s => s.ws === ws) || null;

function addSpec(room, ws, name) {
  watchers.delete(ws);
  const sp = { id: room.nextId++, name, ws, lastChat: 0 };
  room.specs.push(sp);
  ws.roomCode = room.code; ws.playerId = null; ws.specId = sp.id;
  send(ws, { t: 'welcome', role: 'spec', you: null, specId: sp.id, code: room.code });
  pushState(room);
  listChanged();
  return sp;
}

function removeSpec(room, ws) {
  const i = room.specs.findIndex(s => s.ws === ws);
  if (i >= 0) room.specs.splice(i, 1);
  ws.specId = null;
  return i >= 0;
}

function seatSpecs(room) {
  if (room.phase !== 'lobby') return;
  let moved = false;
  while (room.specs.length && room.players.length < MAX_PLAYERS) {
    const sp = room.specs.shift();
    if (!sp.ws || sp.ws.readyState !== 1) continue;
    const p = addPlayer(room, { name: sp.name });
    sp.ws.specId = null;
    attach(room, p, sp.ws, { seated: true });
    ev(room, { kind: 'joined', by: p.id });
    moved = true;
  }
  if (moved) listChanged();
}

function dropRoom(room) {
  clearAll(room);
  for (const sp of room.specs) {
    send(sp.ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
    sp.ws.roomCode = null; sp.ws.specId = null;
    try { sp.ws.close(1000, 'room gone'); } catch (_) {}
  }
  room.specs = [];
  rooms.delete(room.code);
  listChanged();
}

/* ─────────────────────────── 판 ─────────────────────────── */

function clearTurn(room) {
  clearTimeout(room.timers.turn); room.timers.turn = null;
  clearTimeout(room.timers.bot); room.timers.bot = null;
  clearTimeout(room.timers.dc); room.timers.dc = null;
}
function clearAll(room) {
  clearTurn(room);
  clearTimeout(room.timers.reveal); room.timers.reveal = null;
}

const edOf = room => room.cfg.edition;

/** 지금 무언가를 해야 하는 사람 — 특수 카드 값 치르기 · 오가는 카드 받은 사람 · 내밀 사람 순 */
function actorOf(room) {
  if (room.phase !== 'playing' || room.reveal) return null;
  if (room.tribute) return playerOf(room, room.tribute.who);
  return playerOf(room, room.chain ? room.chain.to : room.starter);
}

/** 카드를 받은 사람이 몰래 보고 넘길 수 있는 상대 — 아직 이 카드를 안 본 사람 */
function passTargets(room) {
  const c = room.chain;
  if (!c || !R.canPass(edOf(room), room.players.length)) return [];
  return room.players.filter(p => p.id !== c.to && !c.seen.includes(p.id)).map(p => p.id);
}

/** 할 사람이 바뀔 때마다 — 제한 시간, 봇, 끊긴 사람 대신 두기를 다시 건다 */
function nudge(room, { keepClock = false } = {}) {
  clearTurn(room);
  const p = actorOf(room);
  if (!p) { pushState(room); return; }
  if (!keepClock) room.turnEndsAt = room.cfg.turnLimit ? Date.now() + room.cfg.turnLimit : 0;
  pushState(room);

  if (p.bot) {
    room.timers.bot = setTimeout(() => botAct(room, p.id), rnd(...BOT_THINK));
    return;
  }
  if (room.turnEndsAt) {
    room.timers.turn = setTimeout(() => {
      if (actorOf(room) === p) { ev(room, { kind: 'timeout', by: p.id }); autoAct(room, p); }
    }, Math.max(0, room.turnEndsAt - Date.now()) + 250);
  }
  if (!p.connected) {
    room.timers.dc = setTimeout(() => { if (actorOf(room) === p && !p.connected) autoAct(room, p); }, DC_GRACE);
  }
}

function startGame(room) {
  clearAll(room);
  const ed = edOf(room);
  const n = room.players.length;
  room.phase = 'playing';
  room.gameNo++;
  room.chain = null; room.reveal = null; room.tribute = null; room.history = [];
  room.loser = null; room.loseWhy = null; room.loseKind = null;
  room.loseAt = R.loseAt(ed, n);
  room.fx = null;
  const order = shuffle(room.players.slice());
  const { hands, penalty, removed } = R.deal(shuffle(R.makeDeck(ed)), n, ed);
  room.removed = removed.length;          // 기본판 2인 — 아무도 모르는 10장
  order.forEach((p, i) => { p.hand = hands[i]; p.row = R.emptyRow(ed); p.crowns = {}; });
  room.penalty = penalty;                 // 맨 끝 장이 펼쳐진 윗장
  // 처음 내미는 사람 — 로얄판은 한 장 더 받은 첫 사람, 기본판은 덜 받은 끝 사람
  room.starter = (ed === 'royal' ? order[0] : order[order.length - 1]).id;
  listChanged();
  nudge(room);
}

function finish(room, loser, why, kind) {
  clearAll(room);
  room.phase = 'over';
  room.chain = null; room.tribute = null;
  room.turnEndsAt = 0;
  room.loser = loser.id; room.loseWhy = why; room.loseKind = kind || null;
  pushState(room);
  listChanged();
}

/**
 * 카드 한 장을 p 앞에 내려놓는다. 왕 카드면 벌칙 더미 윗장도 가져온다(왕이 나오면 또).
 * 내려놓인 카드는 fx 에 모아 두었다가 화면이 날아가는 모습을 그린다.
 */
function place(room, p, card, src, fx) {
  if (R.isSpecial(card)) {
    // 벌칙 더미에서 특수 카드가 나왔다 — 원작 규칙서에 따로 없는 경우라, 떠안았을 때와 똑같이 손으로 가져가고 값을 치른다
    // (그냥 손에 넣으면 벌칙이 오히려 좋은 패가 된다)
    p.hand.push(card);
    fx.push({ k: card.k, src, toHand: true });
    (room.pendingTrib = room.pendingTrib || []).push(card.k);
    return;
  }
  p.row[card.k] = (p.row[card.k] || 0) + 1;
  if (card.r) p.crowns[card.k] = (p.crowns[card.k] || 0) + 1;
  fx.push({ k: card.k, r: !!card.r, src });
  if (card.r && room.penalty.length) place(room, p, room.penalty.pop(), 'penalty', fx);
}

/** 내려놓은 뒤 — 같은 생물이 너무 많이 쌓였으면 진다. 아니면 p 가 다음에 내민다(손이 비었으면 진다). */
function afterPlace(room, p, fx) {
  room.fxSeq = (room.fxSeq || 0) + 1;
  room.fx = { seq: room.fxSeq, who: p.id, cards: fx };
  const over = Object.keys(p.row).find(k => p.row[k] >= room.loseAt);
  if (over) { room.pendingTrib = []; return finish(room, p, 'four', over); }
  if (room.pendingTrib && room.pendingTrib.length) {
    const k = room.pendingTrib.shift();
    room.tribute = { who: p.id, claim: room.lastClaim, card: k, fromPenalty: true };
    if (!tributeOptions(room, p).length) return settleTribute(room, p, []);
    return nudge(room);
  }
  room.starter = p.id;
  if (!p.hand.length) return finish(room, p, 'empty');
  nudge(room);
}

/** 카드 내밀기 — 손에서 한 장 골라 누구에게 무엇이라고 말하며 */
function give(room, p, cardId, to, claim) {
  if (room.phase !== 'playing' || room.reveal || room.tribute || room.chain || room.starter !== p.id) return;
  const i = p.hand.findIndex(c => c.id === cardId);
  const target = playerOf(room, to);
  if (i < 0 || !target || target.id === p.id || !R.isClaim(edOf(room), claim)) return;
  const [card] = p.hand.splice(i, 1);
  room.chain = { card, from: p.id, to: target.id, claim, seen: [p.id], path: [{ from: p.id, to: target.id, claim }], step: 'decide' };
  ev(room, { kind: 'give', by: p.id, to: target.id, claim });
  nudge(room);
}

/** 받은 카드를 몰래 본다 — 본 뒤에는 반드시 다른 사람에게 넘겨야 한다 */
function peek(room, p) {
  const c = room.chain;
  if (room.phase !== 'playing' || room.reveal || !c || c.to !== p.id || c.step !== 'decide') return;
  if (!passTargets(room).length) return send(p.ws, { t: 'err', msg: '넘길 사람이 없어요. 진짜인지 거짓인지 골라야 해요.' });
  c.seen.push(p.id);
  c.step = 'pass';
  ev(room, { kind: 'peek', by: p.id });
  nudge(room);
}

/** 몰래 본 카드를 넘긴다 — 아직 안 본 사람에게, 아무것이라고 */
function pass(room, p, to, claim) {
  const c = room.chain;
  if (room.phase !== 'playing' || room.reveal || !c || c.to !== p.id || c.step !== 'pass') return;
  if (!passTargets(room).includes(to) || !R.isClaim(edOf(room), claim)) return;
  c.from = p.id; c.to = to; c.claim = claim; c.step = 'decide';
  c.path.push({ from: p.id, to, claim });
  ev(room, { kind: 'give', by: p.id, to, claim, pass: true });
  nudge(room);
}

/** "진짜다" / "거짓말!" — 카드를 뒤집는다 */
function call(room, p, sayTrue) {
  const c = room.chain;
  if (room.phase !== 'playing' || room.reveal || !c || c.to !== p.id || c.step !== 'decide') return;
  clearTurn(room);
  const j = R.judge(c.card, c.claim, !!sayTrue);
  const taker = j.taker === 'from' ? c.from : c.to;
  const card = c.card;
  room.reveal = {
    card: { k: card.k, r: !!card.r }, claim: c.claim, sayTrue: !!sayTrue, truth: j.truth, right: j.right,
    caller: c.to, passer: c.from, taker, path: c.path,
  };
  room.history.unshift({ card: { k: card.k, r: !!card.r }, claim: c.claim, caller: c.to, passer: c.from, taker, right: j.right });
  room.history.length = Math.min(room.history.length, HISTORY);
  room.chain = null;
  room.turnEndsAt = 0;
  pushState(room);

  room.timers.reveal = setTimeout(() => {
    room.timers.reveal = null;
    if (room.phase !== 'playing') return;
    const t = playerOf(room, taker);
    const claim = room.reveal.claim;
    room.lastClaim = claim;
    room.pendingTrib = [];
    room.reveal = null;
    if (!t) { nudge(room); return; }
    if (R.isSpecial(card)) {
      // 특수 카드는 손으로 가져가고, 그 값으로 손에서 카드를 내려놓는다
      t.hand.push(card);
      room.tribute = { who: t.id, claim, card: card.k };
      room.fxSeq = (room.fxSeq || 0) + 1;
      room.fx = { seq: room.fxSeq, who: t.id, cards: [{ k: card.k, src: 'chain', toHand: true }] };
      if (!tributeOptions(room, t).length) return settleTribute(room, t, []);
      return nudge(room);
    }
    const fx = [];
    place(room, t, card, 'chain', fx);
    afterPlace(room, t, fx);
  }, REVEAL_MS);
}

/* ── 특수 카드 값 치르기 ──
   마지막에 들은 말과 맞는 카드 1장을 내려놓거나, 그게 없거나 싫으면 아무 카드 2장.
   손에 (특수 카드 말고) 내려놓을 카드가 2장도 안 되면 있는 만큼만 내려놓는다. */

const tributeOptions = (room, p) => p.hand.filter(c => !R.isSpecial(c));

/** 이 고른 묶음(id 들)이 값으로 맞나 */
function tributeOk(room, p, ids) {
  const opts = tributeOptions(room, p);
  const cards = ids.map(id => opts.find(c => c.id === id));
  if (cards.some(c => !c) || new Set(ids).size !== ids.length) return false;
  if (cards.length === 1) return R.tributeMatch(cards[0], room.tribute.claim) || opts.length === 1;
  if (cards.length === 2) return true;
  return cards.length === opts.length && opts.length < 2;
}

function settleTribute(room, p, ids) {
  const fx = room.fx && room.fx.who === p.id ? room.fx.cards.slice() : [];
  room.tribute = null;
  for (const id of ids) {
    const i = p.hand.findIndex(c => c.id === id);
    if (i >= 0) place(room, p, p.hand.splice(i, 1)[0], 'hand', fx);
  }
  afterPlace(room, p, fx);
}

function tribute(room, p, ids) {
  if (room.phase !== 'playing' || !room.tribute || room.tribute.who !== p.id || !Array.isArray(ids)) return;
  ids = ids.map(x => x | 0).slice(0, 2);
  if (!tributeOk(room, p, ids)) return send(p.ws, { t: 'err', msg: '말한 것과 맞는 카드 1장이나, 아무 카드 2장을 골라 주세요.' });
  clearTurn(room);
  ev(room, { kind: 'tribute', by: p.id, n: ids.length });
  settleTribute(room, p, ids);
}

/* ─────────────────────────── 봇 ───────────────────────────
   봇은 자기 손패 · 모두의 앞줄 · 자기가 본 카드만 안다. 너무 영리하지 않게 운도 섞는다. */

/** 아직 어디 있는지 모르는(내 손에도, 누구 앞에도 없는) 그 말에 맞는 카드 수 — 대략 */
function unseen(room, p, claim) {
  const ed = edOf(room);
  if (claim === 'royal') {
    const known = p.hand.filter(c => c.r).length + room.players.reduce((s, q) => s + Object.values(q.crowns || {}).reduce((a, b) => a + b, 0), 0);
    return Math.max(0, R.ROYAL_KINDS.length - known) + 0.5;
  }
  const total = R.PER_KIND + (ed === 'royal' ? 2 : 0);   // 왕 1장 + 신하
  let known = p.hand.filter(c => c.k === claim || c.k === 'subject').length;
  for (const q of room.players) known += q.row[claim] || 0;
  return Math.max(0, total - known);
}

/** 상대를 고를 때 — 이미 앞에 많이 쌓인 사람, 특히 kind 가 많이 쌓인 사람을 노린다 */
function targetScore(room, q, kind) {
  const most = Math.max(...Object.values(q.row));
  return (kind && q.row[kind] != null ? q.row[kind] * 3 : 0) + most + Math.random() * 2.5;
}

/** 이 카드를 두고 무엇이라 말할까 — 가끔은 진짜, 대개는 상대가 많이 쌓은 생물이라고 우긴다 */
function bluffClaim(room, target, card) {
  const plain = R.claimsOf(edOf(room));
  // 다섯 번에 한 번쯤은 "○○가 아니야" 로 말한다 — 상대가 많이 쌓은 생물을 아니라고 하면 받는 쪽이 더 헷갈린다
  const claims = Math.random() < 0.2 ? plain.map(c => R.NOT + c) : plain;
  const truths = claims.filter(cl => R.truthOf(card, cl));
  if (truths.length && Math.random() < 0.38) return pick(truths);
  const lies = claims.filter(cl => !R.truthOf(card, cl));
  lies.sort((a, b) => ((target.row[b] || 0) - (target.row[a] || 0)) + (Math.random() - 0.5) * 2);
  return Math.random() < 0.6 ? lies[0] : pick(lies);
}

function botGive(room, p) {
  // 많이 든 생물부터 털어 낸다. 특수 카드는 좋은 패라 아껴 두다 가끔 쓴다.
  // 누군가 한 장만 더 받으면 지는 생물을 쥐고 있으면 그 카드가 가장 좋은 패다.
  const count = k => p.hand.filter(c => c.k === k).length;
  const others0 = room.players.filter(q => q.id !== p.id);
  const killer = k => others0.some(q => (q.row[k] || 0) === room.loseAt - 1);
  const worth = c => (R.isSpecial(c) ? -3 : 0) + count(c.k) + (killer(c.k) ? 5 : 0) + (Math.random() - 0.5) * 3;
  const card = p.hand.slice().sort((a, b) => worth(b) - worth(a))[0];
  const others = room.players.filter(q => q.id !== p.id);
  const target = others.sort((a, b) => targetScore(room, b, card.k) - targetScore(room, a, card.k))[0];
  give(room, p, card.id, target.id, bluffClaim(room, target, card));
}

function botDecide(room, p) {
  const c = room.chain;
  const targets = passTargets(room);
  const base = R.baseOf(c.claim), neg = R.isNeg(c.claim);
  const danger = (p.row[base] || 0) >= room.loseAt - 2;
  if (targets.length && Math.random() < (danger ? 0.55 : 0.28)) return peek(room, p);
  const left = unseen(room, p, base);
  let pTrue = left <= 0 ? 0.03 : 0.18 + 0.62 * Math.min(1, left / R.PER_KIND);
  if (neg) pTrue = 1 - pTrue;                      // "아니야" 는 뒤집어서 믿는다
  // 한 장만 더 받으면 지는 생물이라고 들었다 — 틀렸을 때 그 생물을 떠안는 쪽을 피한다
  //  "박쥐야" 를 거짓말이라 했다가 틀리면 박쥐를 떠안는다 → 믿는 쪽으로
  //  "박쥐가 아니야" 를 믿었다가 틀리면 박쥐를 떠안는다 → 의심하는 쪽으로
  if ((p.row[base] || 0) === room.loseAt - 1) pTrue = neg ? Math.min(pTrue, 0.25) : Math.max(pTrue, 0.75);
  const passer = playerOf(room, c.from);
  if (passer && passer.hand.length <= 2) pTrue += 0.1;
  call(room, p, Math.random() < pTrue);
}

function botPass(room, p) {
  const c = room.chain;
  const qs = passTargets(room).map(id => playerOf(room, id));
  const target = qs.sort((a, b) => targetScore(room, b, c.card.k) - targetScore(room, a, c.card.k))[0];
  pass(room, p, target.id, bluffClaim(room, target, c.card));
}

/** 값 치르기 — 내 앞에 적게 쌓인 생물로 낸다 */
function botTribute(room, p) {
  const opts = tributeOptions(room, p);
  const low = c => (p.row[c.k] || 0) + (c.r ? 1.5 : 0) + Math.random() * 0.3;
  const match = opts.filter(c => R.tributeMatch(c, room.tribute.claim)).sort((a, b) => low(a) - low(b));
  const two = opts.slice().sort((a, b) => low(a) - low(b)).slice(0, 2);
  let ids;
  if (opts.length < 2) ids = opts.map(c => c.id);
  else if (match.length && (low(match[0]) <= low(two[0]) + low(two[1]) || Math.random() < 0.7)) ids = [match[0].id];
  else ids = two.map(c => c.id);
  tribute(room, p, ids);
}

function botAct(room, id) {
  const p = playerOf(room, id);
  if (!p || actorOf(room) !== p) return;
  autoAct(room, p);
}

/** 봇 · 시간 초과 · 끊긴 사람 — 같은 머리로 둔다 */
function autoAct(room, p) {
  if (actorOf(room) !== p) return;
  if (room.tribute) return botTribute(room, p);
  if (!room.chain) return p.hand.length ? botGive(room, p) : finish(room, p, 'empty');
  if (room.chain.step === 'pass') return botPass(room, p);
  botDecide(room, p);
  // 끊긴 사람 · 시간 초과로 대신 둘 때 몰래 보기를 골랐으면 넘기기까지 이어서 한다 — 안 그러면 판이 한 번 더 멈춘다
  if (!p.bot && actorOf(room) === p && room.chain && room.chain.step === 'pass') botPass(room, p);
}

/* ─────────────────────────── 통신 ─────────────────────────── */

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }
}

const ORDER = R.KINDS.concat('subject', 'black');
const sortHand = h => h.slice().sort((a, b) =>
  ORDER.indexOf(a.k) - ORDER.indexOf(b.k) || (a.r ? 1 : 0) - (b.r ? 1 : 0) || a.id - b.id);

function stateFor(room, me) {
  const c = room.chain;
  const ed = edOf(room);
  const top = room.penalty && room.penalty.length ? room.penalty[room.penalty.length - 1] : null;
  return {
    t: 'state',
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    cfg: room.cfg,
    max: MAX_PLAYERS,
    min: MIN_PLAYERS,
    gameNo: room.gameNo,
    kinds: R.kindsOf(ed),
    claims: R.claimsOf(ed),
    loseAt: room.phase === 'lobby' ? R.loseAt(ed, room.players.length) : room.loseAt,
    canPass: R.canPass(ed, room.players.length),
    starter: room.starter,
    turnEndsAt: room.turnEndsAt,
    now: Date.now(),
    you: me ? me.id : null,
    role: me ? 'player' : 'spec',
    specs: room.specs.map(s => s.name),
    hand: me ? sortHand(me.hand) : [],
    // 오가는 카드의 정체는 본 사람에게만
    chain: c ? {
      from: c.from, to: c.to, claim: c.claim, seen: c.seen.slice(), path: c.path, step: c.step,
      card: me && c.seen.includes(me.id) ? { k: c.card.k, r: !!c.card.r } : null,
      targets: passTargets(room),
    } : null,
    reveal: room.reveal,
    tribute: room.tribute,
    removed: room.phase === 'lobby' ? R.removedSize(ed, room.players.length) : room.removed || 0,
    penalty: ed === 'royal' && room.phase !== 'lobby' ? { n: room.penalty.length, top: top ? { k: top.k, r: !!top.r } : null } : null,
    fx: room.fx,
    history: room.history,
    loser: room.loser, loseWhy: room.loseWhy, loseKind: room.loseKind,
    players: room.players.map(p => ({
      id: p.id, name: p.name, bot: p.bot, connected: p.connected, face: p.face,
      hand: p.hand.length, row: p.row, crowns: p.crowns || {},
    })),
  };
}

function pushState(room) {
  for (const p of room.players) if (!p.bot) send(p.ws, stateFor(room, p));
  if (room.specs.length) {
    const view = stateFor(room, null);
    for (const sp of room.specs) send(sp.ws, view);
  }
}
function broadcast(room, obj) {
  for (const p of room.players) if (!p.bot) send(p.ws, obj);
  for (const sp of room.specs) send(sp.ws, obj);
}
const ev = (room, obj) => broadcast(room, Object.assign({ t: 'ev' }, obj));

/* ─────────────────────────── 열린 방 목록 (로보77 과 같다) ─────────────────────────── */

const watchers = new Set();
let listT = null;

function listChanged() {
  if (listT || !watchers.size) return;
  listT = setTimeout(() => { listT = null; pushList(); }, 300);
}

function roomList() {
  const rs = [];
  for (const r of rooms.values()) {
    if (!r.players.some(p => !p.bot && p.connected)) continue;
    const state = r.phase !== 'lobby' ? 'playing' : r.players.length >= MAX_PLAYERS ? 'full' : 'wait';
    rs.push({ r, state });
  }
  const open = x => (x.state === 'wait' && !x.r.cfg.priv ? 0 : 1);
  rs.sort((a, b) => open(a) - open(b) || b.r.madeAt - a.r.madeAt);
  const list = rs.slice(0, 20).map(({ r, state }) => {
    const host = playerOf(r, r.hostId);
    const e = { ed: r.cfg.edition, host: host ? host.name : '', face: host ? host.face : 'roach', n: r.players.length, max: MAX_PLAYERS, state, spec: r.cfg.spec, watching: r.specs.length };
    if (r.cfg.priv) { e.priv = true; return e; }
    return Object.assign({ code: r.code }, e);
  });
  return { t: 'rooms', list };
}

function pushList() {
  if (!watchers.size) return;
  const text = JSON.stringify(roomList());
  for (const ws of watchers) {
    if (ws.readyState !== 1) { watchers.delete(ws); continue; }
    try { ws.send(text); } catch (_) { watchers.delete(ws); }
  }
}

/* ─────────────────────────── 메시지 처리 ─────────────────────────── */

function attach(room, p, ws, { seated = false } = {}) {
  clearTimeout(p.leaveT);
  watchers.delete(ws);
  p.ws = ws; p.connected = true;
  const host = playerOf(room, room.hostId);
  if (!host || (!host.connected && host !== p)) room.hostId = p.id;
  ws.roomCode = room.code; ws.playerId = p.id;
  send(ws, Object.assign({ t: 'welcome', role: 'player', you: p.id, token: p.token, code: room.code }, seated ? { seated: true } : {}));
  // 내 차례에 끊겼다 돌아왔으면 대신 두려던 예약만 거둔다 (제한 시간은 처음부터 다시 돌지 않는다)
  if (actorOf(room) === p) { clearTimeout(room.timers.dc); room.timers.dc = null; }
  pushState(room);
  listChanged();
}

function detach(ws) {
  const room = rooms.get(ws.roomCode);
  if (room && ws.specId != null) {
    if (removeSpec(room, ws)) { pushState(room); listChanged(); }
  } else if (room) {
    const p = playerOf(room, ws.playerId);
    if (p && p.ws === ws) {
      if (room.phase === 'lobby') {
        removePlayer(room, p.id);
        if (!room.players.some(x => !x.bot)) dropRoom(room);
        else pushState(room);
      } else disconnect(ws);
    }
  }
  ws.roomCode = null; ws.playerId = null; ws.specId = null;
}

function chatText(room, who, msg, extra) {
  const text = clean(msg.text, 200);
  if (!text) return;
  const now = Date.now();
  if (now - (who.lastChat || 0) < 400) return;
  who.lastChat = now;
  broadcast(room, Object.assign({ t: 'chat', from: who.id, name: who.name, text }, extra || {}));
}

const REACTS = 6;

function handle(ws, msg) {
  if ((msg.t === 'create' || msg.t === 'join' || msg.t === 'resume') && ws.roomCode) detach(ws);
  switch (msg.t) {
    case 'rooms':
      if (!ws.roomCode) { watchers.add(ws); send(ws, roomList()); }
      return;
    case 'unwatch':
      watchers.delete(ws);
      return;
    case 'create': {
      const r = createRoom({ priv: msg.priv === true, spec: msg.spec !== false });
      const p = addPlayer(r, { name: clean(msg.name, 12) || '플레이어 1' });
      attach(r, p, ws);
      return;
    }
    case 'join': {
      const code = clean(msg.code, 8).toUpperCase();
      const r = rooms.get(code);
      if (!r) return send(ws, { t: 'err', msg: '그런 방이 없어요. 코드를 확인해 주세요.' });
      if (r.phase !== 'lobby' || r.players.length >= MAX_PLAYERS) {
        if (!r.cfg.spec) {
          return send(ws, { t: 'err', msg: (r.phase !== 'lobby' ? '이미 시작한 방이에요.' : '방이 가득 찼어요.') + ' 관전을 허용하지 않는 방이에요.' });
        }
        if (r.specs.length >= MAX_SPECS) return send(ws, { t: 'err', msg: '관전석이 가득 찼어요.' });
        addSpec(r, ws, clean(msg.name, 12) || `관전자 ${r.specs.length + 1}`);
        return;
      }
      const p = addPlayer(r, { name: clean(msg.name, 12) || `플레이어 ${r.players.length + 1}` });
      attach(r, p, ws);
      ev(r, { kind: 'joined', by: p.id });
      return;
    }
    case 'resume': {
      const r = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!r) return send(ws, { t: 'err', msg: '방이 사라졌어요.', fatal: true });
      const p = r.players.find(x => x.token === msg.token && !x.bot);
      if (!p) return send(ws, { t: 'err', msg: '자리를 찾을 수 없어요.', fatal: true });
      if (p.ws && p.ws !== ws) { send(p.ws, { t: 'moved' }); try { p.ws.close(4001, 'moved'); } catch (_) {} }
      attach(r, p, ws);
      return;
    }
  }

  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) return handleSpec(room, ws, msg);
  const me = playerOf(room, ws.playerId);
  if (!me || me.bot) return;
  const isHost = room.hostId === me.id;
  room.lastActive = Date.now();

  switch (msg.t) {
    case 'cfg': {
      if (!isHost || room.phase === 'playing') return;
      if (TURN_LIMITS.includes(msg.turnLimit)) room.cfg.turnLimit = msg.turnLimit;
      if (R.EDITIONS.includes(msg.edition) && msg.edition !== room.cfg.edition) { room.cfg.edition = msg.edition; listChanged(); }
      if (typeof msg.priv === 'boolean' && msg.priv !== room.cfg.priv) { room.cfg.priv = msg.priv; listChanged(); }
      if (typeof msg.spec === 'boolean' && msg.spec !== room.cfg.spec) { room.cfg.spec = msg.spec; listChanged(); }
      pushState(room);
      break;
    }
    case 'face': {
      // 대기실에서 내 얼굴(생물)을 바꾼다 — 남이 쓰는 얼굴은 못 고른다
      if (room.phase === 'playing' || !R.KINDS.includes(msg.face)) return;
      if (room.players.some(p => p !== me && p.face === msg.face)) return;
      me.face = msg.face;
      pushState(room);
      break;
    }
    case 'addBot': {
      if (!isHost || room.phase === 'playing') return;
      if (room.players.length >= MAX_PLAYERS) return send(ws, { t: 'err', msg: '자리가 없어요.' });
      const used = new Set(room.players.map(p => p.name));
      addPlayer(room, { name: BOT_NAMES.find(n => !used.has(n)) || `봇 ${room.players.length + 1}`, bot: true });
      pushState(room); listChanged();
      break;
    }
    case 'kick': {
      if (!isHost || room.phase === 'playing') return;
      const target = playerOf(room, msg.id);
      if (!target || target.id === room.hostId) return;
      if (target.ws) send(target.ws, { t: 'err', msg: '방장이 내보냈어요.', fatal: true });
      removePlayer(room, target.id);
      pushState(room);
      break;
    }
    case 'start': {
      if (!isHost || room.phase === 'playing') return;
      if (room.players.length < MIN_PLAYERS) return send(ws, { t: 'err', msg: '두 명은 있어야 시작할 수 있어요. 봇을 불러 보세요.' });
      startGame(room);
      break;
    }
    case 'give': give(room, me, msg.card | 0, msg.to | 0, String(msg.claim)); break;
    case 'peek': peek(room, me); break;
    case 'pass': pass(room, me, msg.to | 0, String(msg.claim)); break;
    case 'call': call(room, me, msg.sayTrue === true); break;
    case 'tribute': tribute(room, me, msg.ids); break;

    case 'chat': chatText(room, me, msg); break;
    case 'react': {
      const e = msg.e | 0;
      const now = Date.now();
      if (e < 0 || e >= REACTS || now - me.lastReact < 700) return;
      me.lastReact = now;
      broadcast(room, { t: 'react', from: me.id, e });
      break;
    }
    case 'again': {
      if (!isHost || room.phase !== 'over') return;
      clearAll(room);
      room.phase = 'lobby';
      room.chain = null; room.reveal = null; room.tribute = null; room.loser = null; room.history = []; room.fx = null; room.penalty = [];
      // 판 중에 떠나 봇이 된 자리는 대기실로 돌아오면서 비운다 — 다음 판에 남이 쓴 봇이 끼지 않게
      room.players = room.players.filter(p => !p.stood);
      for (const p of room.players) { p.hand = []; p.row = {}; p.crowns = {}; }
      for (const p of room.players) if (!p.bot && !p.connected) armLeave(room, p);
      if (!playerOf(room, room.hostId)) pickHost(room);
      seatSpecs(room);
      pushState(room);
      listChanged();
      break;
    }
    case 'leave':
      removePlayer(room, me.id);
      ws.roomCode = null; ws.playerId = null;
      send(ws, { t: 'left' });
      if (!room.players.some(x => !x.bot)) { if (room.phase === 'lobby') dropRoom(room); }
      else pushState(room);
      break;
  }
}

function handleSpec(room, ws, msg) {
  const sp = specOf(room, ws);
  if (!sp) return;
  if (msg.t === 'chat') chatText(room, sp, msg, { spec: true });
  else if (msg.t === 'leave') {
    removeSpec(room, ws);
    ws.roomCode = null; ws.playerId = null;
    send(ws, { t: 'left' });
    pushState(room);
    listChanged();
  }
}

function armLeave(room, p) {
  clearTimeout(p.leaveT);
  p.leaveT = setTimeout(() => {
    if (p.connected || room.phase !== 'lobby' || rooms.get(room.code) !== room) return;
    removePlayer(room, p.id);
    if (!room.players.some(x => !x.bot)) dropRoom(room);
    else pushState(room);
  }, LOBBY_GRACE);
}

function disconnect(ws, { keepSeat = false } = {}) {
  watchers.delete(ws);
  const room = rooms.get(ws.roomCode);
  if (!room) return;
  if (ws.specId != null) {
    if (removeSpec(room, ws)) { pushState(room); listChanged(); }
    return;
  }
  const p = playerOf(room, ws.playerId);
  if (!p || p.ws !== ws) return;
  p.connected = false; p.ws = null;
  listChanged();
  room.lastActive = Date.now();

  if (room.hostId === p.id) {
    clearTimeout(room.timers.host);
    room.timers.host = setTimeout(() => {
      const h = playerOf(room, room.hostId);
      if (h && h.connected) return;
      const next = room.players.find(x => !x.bot && x.connected);
      if (next) { room.hostId = next.id; pushState(room); }
    }, LOBBY_GRACE);
  }

  if (room.phase === 'lobby') {
    clearTimeout(p.leaveT);
    if (!keepSeat) armLeave(room, p);
  } else if (actorOf(room) === p) {
    clearTimeout(room.timers.dc);
    room.timers.dc = setTimeout(() => { if (actorOf(room) === p && !p.connected) autoAct(room, p); }, DC_GRACE);
  }
  pushState(room);
}

/** 사람이 다 떠난 방을 치운다. 통신 쪽이 30초마다 부른다. */
function sweepRooms(now = Date.now()) {
  for (const room of [...rooms.values()]) {
    const humans = room.players.filter(p => !p.bot && p.connected).length;
    // 사람이 앉아 있던 방은 모두 끊겨도 10분 기다린다 — 폰을 잠깐 잠갔다 돌아와도 판이 남아 있게(그동안 차례는 대신 둔다)
    const seated = room.phase !== 'over' && room.players.some(p => !p.bot && !p.stood);
    if (humans === 0 && now - room.lastActive > (seated ? 10 * 60_000 : 90_000)) dropRoom(room);
  }
}

function selfCheck() {
  const want = { base: 64, royal: 65 };   // 로얄: 생물 56 + 왕 7 + 신하·검은 카드 2 (상자 표기 66장은 설명 카드 포함)
  for (const ed of R.EDITIONS) {
    const deck = R.makeDeck(ed);
    if (deck.length !== want[ed]) throw new Error(`${ed} 덱이 ${deck.length}장입니다 (${want[ed]}장이어야 함)`);
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const { hands, penalty, removed } = R.deal(deck, n, ed);
      if (hands.reduce((a, h) => a + h.length, 0) + penalty.length + removed.length !== deck.length) throw new Error(`${ed} ${n}인 나누기가 어긋납니다`);
    }
  }
  console.log(`  기본판 64장 · 로얄판 65장 · ${MIN_PLAYERS}~${MAX_PLAYERS}인`);
}

module.exports = { rooms, handle, disconnect, sweepRooms, selfCheck, MAX_PLAYERS, MAX_SPECS, _test: { stateFor, autoAct, actorOf } };
