'use strict';
/**
 * 떠 있는 서버에 진짜 웹소켓으로 붙어 본다 — PORT=8795 node test/e2e.js
 * 사람 둘(방장·손님) + 봇 둘. 열린 방 목록에 뜨는지, 들어가지는지, 채팅이 오가는지, 판이 끝까지 가는지.
 * 판을 빨리 보려면 서버를 ROACH_FAST=1 로 띄운다.
 */
const assert = require('assert');
const WebSocket = require('ws');
const R = require('../rules');

const URL = `ws://127.0.0.1:${process.env.PORT || 8795}/ws`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = a => a[Math.floor(Math.random() * a.length)];

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], last: null, me: null, rooms: null };
  ws.on('message', d => {
    const m = JSON.parse(d);
    c.msgs.push(m);
    if (m.t === 'state') c.last = m;
    if (m.t === 'welcome') c.me = m.you;
    if (m.t === 'rooms') c.rooms = m.list;
  });
  c.send = o => ws.send(JSON.stringify(o));
  c.open = new Promise(r => ws.on('open', r));
  return c;
}

function move(c) {
  const s = c.last;
  if (!s || s.phase !== 'playing' || s.reveal) return;
  const me = c.me;
  if (s.tribute) {
    if (s.tribute.who !== me) return;
    const opts = s.hand.filter(x => !R.isSpecial(x));
    return c.send({ t: 'tribute', ids: opts.length < 2 ? opts.map(x => x.id) : [opts[0].id, opts[1].id] });
  }
  if (s.chain) {
    if (s.chain.to !== me) return;
    if (s.chain.step === 'pass') return c.send({ t: 'pass', to: pick(s.chain.targets), claim: pick(s.claims) });
    if (s.chain.targets.length && Math.random() < 0.3) return c.send({ t: 'peek' });
    return c.send({ t: 'call', sayTrue: Math.random() < 0.5 });
  }
  if (s.starter === me && s.hand.length) {
    c.send({ t: 'give', card: pick(s.hand).id, to: pick(s.players.filter(p => p.id !== me)).id, claim: pick(s.claims) });
  }
}

(async () => {
  const host = client('방장'), guest = client('손님');
  await Promise.all([host.open, guest.open]);
  guest.send({ t: 'rooms' });
  host.send({ t: 'create', name: '방장' });
  await sleep(700);
  const code = host.last.code;
  assert.ok(guest.rooms && guest.rooms.some(r => r.code === code), '열린 방 목록에 안 뜸');
  assert.strictEqual(guest.rooms.find(r => r.code === code).ed, 'royal');
  guest.send({ t: 'join', code, name: '손님' });
  await sleep(300);
  assert.strictEqual(host.last.players.length, 2);
  host.send({ t: 'cfg', edition: 'base' });
  host.send({ t: 'addBot' }); host.send({ t: 'addBot' });
  guest.send({ t: 'chat', text: '안녕하세요' });
  await sleep(300);
  assert.ok(host.msgs.some(m => m.t === 'chat' && m.text === '안녕하세요'), '채팅이 안 옴');
  assert.strictEqual(host.last.cfg.edition, 'base');
  host.send({ t: 'start' });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await sleep(30);
    move(host); move(guest);
    if (host.last.phase === 'over') break;
  }
  assert.strictEqual(host.last.phase, 'over', '판이 안 끝남');
  // 손님 화면에 방장 손패 정체가 샌 적 없는지
  for (const m of guest.msgs) if (m.t === 'state' && m.chain && !m.chain.seen.includes(guest.me)) assert.strictEqual(m.chain.card, null);
  console.log('ok — 진 사람:', host.last.players.find(p => p.id === host.last.loser).name, host.last.loseWhy, `${Math.round((Date.now() - t0) / 1000)}초`);
  host.send({ t: 'again' });
  await sleep(200);
  assert.strictEqual(host.last.phase, 'lobby');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
