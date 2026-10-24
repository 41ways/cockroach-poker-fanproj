'use strict';
/**
 * 대량 시뮬레이션 — node test/soak.js 2000 [동시 방 수]   (판 수. 윈도우·맥 같은 명령 — 환경 변수 GAMES 도 된다)
 * 방을 여러 개 동시에 돌린다. 방마다 '무작위로 두는 사람' 한 자리 + 나머지는 봇.
 * 매 상태마다: 카드 수 보존, 앞줄이 패배 기준을 넘지 않는지, 관전자 · 무작위 자리에 카드 정체가 새지 않는지.
 * 끝나면: 끝나지 않은 판, 판 길이, 지는 이유, 무작위 자리가 지는 비율(봇이 무작위보다 나은가).
 */
process.env.ROACH_FAST = '1';
const assert = require('assert');
const R = require('../rules');
const G = require('../game');

const GAMES = Number(process.argv[2]) || Number(process.env.GAMES) || 600;
const PAR = Number(process.argv[3]) || Number(process.env.PAR) || 40;
const LIMIT_MS = 120_000;
const pick = a => a[Math.floor(Math.random() * a.length)];
const randClaim = s => (Math.random() < 0.3 ? '!' : '') + pick(s.claims);

class Fake {
  constructor(onState) { this.readyState = 1; this.onState = onState; this.me = null; }
  send(t) {
    const m = JSON.parse(t);
    if (m.t === 'welcome') this.me = m.you;
    if (m.t === 'state') { this.last = m; this.onState && this.onState(m); }
  }
  close() { this.readyState = 3; }
}

function conserve(room) {
  const total = R.makeDeck(room.cfg.edition).length;
  let n = (room.penalty ? room.penalty.length : 0) + (room.removed || 0) + (room.chain ? 1 : 0) + (room.reveal ? 1 : 0);
  for (const p of room.players) n += p.hand.length + Object.values(p.row).reduce((a, b) => a + b, 0);
  assert.strictEqual(n, total, `카드 ${n}장 (${total}장이어야)`);
  for (const p of room.players) for (const v of Object.values(p.row)) assert.ok(v <= room.loseAt, '패배 기준을 넘긴 앞줄');
}

function randomMove(ws) {
  const s = ws.last, me = ws.me;
  if (!s || s.phase !== 'playing' || s.reveal) return;
  if (s.tribute) {
    if (s.tribute.who !== me) return;
    const opts = s.hand.filter(c => !R.isSpecial(c));
    const match = opts.filter(c => R.tributeMatch(c, s.tribute.claim));
    if (opts.length < 2) return G.handle(ws, { t: 'tribute', ids: opts.map(c => c.id) });
    if (match.length && Math.random() < 0.5) return G.handle(ws, { t: 'tribute', ids: [pick(match).id] });
    const a = pick(opts), b = pick(opts.filter(c => c !== a));
    return G.handle(ws, { t: 'tribute', ids: [a.id, b.id] });
  }
  if (s.chain) {
    if (s.chain.to !== me) return;
    if (s.chain.step === 'pass') return G.handle(ws, { t: 'pass', to: pick(s.chain.targets), claim: randClaim(s) });
    if (s.chain.targets.length && Math.random() < 0.3) return G.handle(ws, { t: 'peek' });
    return G.handle(ws, { t: 'call', sayTrue: Math.random() < 0.5 });
  }
  if (s.starter === me && s.hand.length) {
    G.handle(ws, { t: 'give', card: pick(s.hand).id, to: pick(s.players.filter(p => p.id !== me)).id, claim: randClaim(s) });
  }
}

function one(ed, n) {
  return new Promise(resolve => {
    let room = null, reveals = 0, failed = null;
    const human = new Fake(m => {
      if (!room) return;
      try {
        if (room.phase === 'playing') conserve(room);
        if (m.chain && !m.chain.seen.includes(human.me)) assert.strictEqual(m.chain.card, null, '무작위 자리에 카드 정체가 샘');
        if (m.reveal) reveals++;
      } catch (e) { failed = failed || e; }
      setTimeout(() => randomMove(human), 1);
    });
    const spec = new Fake(m => {
      try {
        assert.deepStrictEqual(m.hand, []);
        if (m.chain) assert.strictEqual(m.chain.card, null, '관전자에게 카드 정체가 샘');
      } catch (e) { failed = failed || e; }
    });
    G.handle(human, { t: 'create', name: '무작위', spec: true });
    room = [...G.rooms.values()].find(r => r.players.some(p => p.ws === human));
    G.handle(human, { t: 'cfg', edition: ed, turnLimit: 0 });
    for (let i = 1; i < n; i++) G.handle(human, { t: 'addBot' });
    G.handle(human, { t: 'start' });
    G.handle(spec, { t: 'join', code: room.code, name: '구경' });
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (room.phase === 'over' || failed || Date.now() - t0 > LIMIT_MS) {
        clearInterval(iv);
        const res = {
          ed, n, over: room.phase === 'over', why: room.loseWhy,
          randomLost: room.loser === human.me, reveals, failed,
          ms: Date.now() - t0,
        };
        G.handle(spec, { t: 'leave' });
        G.handle(human, { t: 'leave' });
        // 사람이 없는 방은 sweep 이 치우지만, 시험에서는 바로 지운다
        G.rooms.delete(room.code);
        resolve(res);
      }
    }, 20);
  });
}

(async () => {
  const jobs = [];
  for (let i = 0; i < GAMES; i++) jobs.push([R.EDITIONS[i % 2], 2 + (Math.floor(i / 2) % 5)]);
  const results = [];
  let idx = 0;
  const t0 = Date.now();
  async function worker() {
    while (idx < jobs.length) {
      const [ed, n] = jobs[idx++];
      results.push(await one(ed, n));
      if (results.length % 100 === 0) process.stdout.write(`${results.length} `);
    }
  }
  await Promise.all(Array.from({ length: PAR }, worker));
  console.log(`\n${results.length}판 · ${Math.round((Date.now() - t0) / 1000)}초`);
  const bad = results.filter(r => r.failed);
  const stuck = results.filter(r => !r.over && !r.failed);
  const table = {};
  for (const r of results) {
    const k = `${r.ed} ${r.n}인`;
    const t = table[k] = table[k] || { 판: 0, 넷: 0, 빈손: 0, 뒤집기평균: 0, 무작위패배율: 0, 기대: (1 / r.n).toFixed(2) };
    t.판++; if (r.why === 'four') t.넷++; if (r.why === 'empty') t.빈손++;
    t.뒤집기평균 += r.reveals; t.무작위패배율 += r.randomLost ? 1 : 0;
  }
  for (const t of Object.values(table)) { t.뒤집기평균 = Math.round(t.뒤집기평균 / t.판); t.무작위패배율 = (t.무작위패배율 / t.판).toFixed(2); }
  console.table(table);
  if (bad.length) { console.log('실패', bad.length); console.log(bad[0].failed); }
  if (stuck.length) console.log('끝나지 않은 판', stuck.length, stuck.slice(0, 3));
  process.exit(bad.length || stuck.length ? 1 : 0);
})();
