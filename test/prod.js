'use strict';
/**
 * 배포본에서 실제 속도로 한 판 — node test/prod.js royal 4
 * 무작위로 두는 사람 한 자리 + 봇. 끝까지 가는지, 걸린 시간, 판정 수.
 */
const WebSocket = require('ws');
const R = require('../rules');
const [ed = 'royal', n = '4'] = process.argv.slice(2);
const URL = process.env.URL || 'wss://cockroach.41ways.workers.dev/ws';
const pick = a => a[Math.floor(Math.random() * a.length)];
const ws = new WebSocket(URL, { headers: { Origin: 'https://cockroach.41ways.workers.dev' } });
let me = null, last = null, reveals = 0, t0 = 0, errs = [];
const send = o => ws.send(JSON.stringify(o));
ws.on('message', d => {
  const m = JSON.parse(d);
  if (m.t === 'welcome') me = m.you;
  if (m.t === 'err') errs.push(m.msg);
  if (m.t !== 'state') return;
  if (m.reveal && (!last || !last.reveal)) reveals++;
  last = m;
  if (m.phase === 'over') {
    const L = m.players.find(p => p.id === m.loser);
    console.log(`${ed} ${n}인 끝 — ${Math.round((Date.now() - t0) / 1000)}초, 판정 ${reveals}번, 진 사람 ${L.name}(${m.loseWhy}${m.loseKind ? ' ' + m.loseKind : ''}), 오류 ${errs.length}`);
    send({ t: 'leave' }); setTimeout(() => process.exit(0), 300);
  }
  setTimeout(move, 300 + Math.random() * 700);
});
function move() {
  const s = last;
  if (!s || s.phase !== 'playing' || s.reveal) return;
  if (s.tribute) { if (s.tribute.who !== me) return; const o = s.hand.filter(c => !R.isSpecial(c)); return send({ t: 'tribute', ids: o.length < 2 ? o.map(c => c.id) : [o[0].id, o[1].id] }); }
  if (s.chain) {
    if (s.chain.to !== me) return;
    if (s.chain.step === 'pass') return send({ t: 'pass', to: pick(s.chain.targets), claim: pick(s.claims) });
    if (s.chain.targets.length && Math.random() < .3) return send({ t: 'peek' });
    return send({ t: 'call', sayTrue: Math.random() < .5 });
  }
  if (s.starter === me && s.hand.length) send({ t: 'give', card: pick(s.hand).id, to: pick(s.players.filter(p => p.id !== me)).id, claim: pick(s.claims) });
}
ws.on('open', () => {
  send({ t: 'create', name: '배포점검', priv: true });
  setTimeout(() => {
    send({ t: 'cfg', edition: ed, turnLimit: 0 });
    for (let i = 1; i < Number(n); i++) send({ t: 'addBot' });
    setTimeout(() => { t0 = Date.now(); send({ t: 'start' }); }, 400);
  }, 600);
});
setTimeout(() => { console.log('시간 초과 — 판이 안 끝남', last && last.phase); process.exit(1); }, 20 * 60_000);
