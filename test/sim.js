'use strict';
/**
 * 판을 끝까지 수백 번 돌려 본다 — node test/sim.js
 * 서버를 띄우지 않고 game.js 에 가짜 소켓을 붙인다. 사람 자리 하나는 무작위로 두고 나머지는 봇.
 * 매 상태마다: 카드가 사라지거나 늘지 않는지, 오가는 카드의 정체가 안 본 사람·관전자에게 새지 않는지.
 */
process.env.ROACH_FAST = '1';
const assert = require('assert');
const R = require('../rules');
const G = require('../game');

const sleep = () => new Promise(r => setTimeout(r, 1));
const GAMES = Number(process.env.GAMES) || 6;

class Fake {
  constructor(name) { this.name = name; this.readyState = 1; this.msgs = []; this.last = null; }
  send(t) { const m = JSON.parse(t); this.msgs.push(m); if (m.t === 'state') this.last = m; }
  close() { this.readyState = 3; }
}

const pick = a => a[Math.floor(Math.random() * a.length)];

function checkState(s, room) {
  // 카드 수 보존 — 손 + 앞줄 + 오가는 카드 + 벌칙 더미 + 뒤집는 중
  const ed = room.cfg.edition;
  const total = R.makeDeck(ed).length;
  let n = 0;
  for (const p of room.players) n += p.hand.length + Object.values(p.row).reduce((a, b) => a + b, 0);
  n += room.chain ? 1 : 0;
  n += room.penalty ? room.penalty.length : 0;
  if (room.reveal) n += 1;
  assert.strictEqual(n, total, `카드가 ${n}장 (${total}장이어야 함) phase=${room.phase}`);
  for (const p of room.players) for (const k of Object.keys(p.row)) assert.ok(p.row[k] <= R.PER_KIND + 1);
}

function checkPrivacy(ws, room, meId) {
  for (const m of ws.msgs) {
    if (m.t !== 'state' || !m.chain) continue;
    const saw = m.chain.seen.includes(meId);
    if (!saw) assert.strictEqual(m.chain.card, null, '안 본 사람에게 카드 정체가 샘');
  }
}

/** 사람 자리 — 상태를 보고 할 수 있는 일 중 하나를 무작위로 */
function humanMove(ws, me) {
  const s = ws.last;
  if (!s || s.phase !== 'playing' || s.reveal) return;
  const send = m => G.handle(ws, m);
  if (s.tribute) {
    if (s.tribute.who !== me) return;
    const opts = s.hand.filter(c => !R.isSpecial(c));
    const match = opts.filter(c => R.tributeMatch(c, s.tribute.claim));
    if (opts.length < 2) return send({ t: 'tribute', ids: opts.map(c => c.id) });
    if (match.length && Math.random() < 0.5) return send({ t: 'tribute', ids: [match[0].id] });
    return send({ t: 'tribute', ids: [opts[0].id, opts[1].id] });
  }
  if (s.chain) {
    if (s.chain.to !== me) return;
    if (s.chain.step === 'pass') return send({ t: 'pass', to: pick(s.chain.targets), claim: pick(s.claims) });
    if (s.chain.targets.length && Math.random() < 0.3) return send({ t: 'peek' });
    return send({ t: 'call', sayTrue: Math.random() < 0.5 });
  }
  if (s.starter === me && s.hand.length) {
    const others = s.players.filter(p => p.id !== me);
    send({ t: 'give', card: pick(s.hand).id, to: pick(others).id, claim: pick(s.claims) });
  }
}

async function one(ed, n) {
  const host = new Fake('host');
  G.handle(host, { t: 'create', name: '사람' });
  const code = host.msgs.find(m => m.t === 'welcome').code;
  const me = host.msgs.find(m => m.t === 'welcome').you;
  const room = G.rooms.get(code);
  G.handle(host, { t: 'cfg', edition: ed, turnLimit: 0 });
  for (let i = 1; i < n; i++) G.handle(host, { t: 'addBot' });
  const spec = new Fake('spec');
  room.cfg.spec = true;
  G.handle(host, { t: 'start' });
  G.handle(spec, { t: 'join', code, name: '구경' });
  assert.strictEqual(room.players.length, n);
  const t0 = Date.now();
  while (room.phase === 'playing' && Date.now() - t0 < 60000) {
    checkState(host.last, room);
    humanMove(host, me);
    await sleep(2);
  }
  assert.strictEqual(room.phase, 'over', '판이 끝나지 않음');
  checkPrivacy(host, room, me);
  for (const m of spec.msgs) if (m.t === 'state') {
    assert.deepStrictEqual(m.hand, []);
    if (m.chain) assert.strictEqual(m.chain.card, null, '관전자에게 카드 정체가 샘');
  }
  const loser = room.players.find(p => p.id === room.loser);
  assert.ok(loser);
  if (room.loseWhy === 'four') assert.ok(loser.row[room.loseKind] >= room.loseAt);
  else assert.strictEqual(loser.hand.length, 0);
  const why = room.loseWhy;
  // 다시 하기 → 대기실
  G.handle(host, { t: 'again' });
  assert.strictEqual(room.phase, 'lobby');
  G.handle(host, { t: 'leave' });
  G.handle(spec, { t: 'leave' });
  return why;
}

(async () => {
  const stat = {};
  for (const ed of R.EDITIONS) {
    for (let n = 2; n <= 6; n++) {
      for (let k = 0; k < GAMES; k++) {
        const why = await one(ed, n);
        const key = `${ed} ${n}인`;
        stat[key] = stat[key] || { four: 0, empty: 0 };
        stat[key][why]++;
        process.stdout.write('.');
      }
    }
  }
  console.table(stat);
  console.log(`ok — 판 ${GAMES * 10}번, 카드 보존·정체 숨김 확인`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
