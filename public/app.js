'use strict';
/**
 * 바퀴벌레 포커 — 클라이언트
 * 판정은 전부 서버가 한다. 여기서는 화면을 그리고 "이 카드를 저 사람에게, 박쥐라고" 만 보낸다.
 * 접속 · 재접속 · 열린 방 목록 · 관전 · 채팅은 로보77 클라이언트와 같은 짜임이다.
 */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const NAMES = {
  roach: '바퀴벌레', rat: '쥐', stink: '노린재', scorp: '전갈',
  toad: '두꺼비', bat: '박쥐', fly: '파리', spider: '거미',
  royal: '왕', subject: '신하', black: '검은 카드',
};
const ALL_KINDS = ['roach', 'rat', 'stink', 'scorp', 'toad', 'bat', 'fly', 'spider'];
const EMO = ['😏', '🤔', '😱', '🙄', '🤥', '👏'];

/* 그림 — 전부 /img 의 제미나이 그림 */
const cardImg = c => !c ? '/img/front.webp'
  : c.k === 'subject' ? '/img/card_subject.webp'
  : c.k === 'black' ? '/img/card_blank.webp'
  : c.r ? `/img/card_k_${c.k}.webp` : `/img/card_${c.k}.webp`;
const faceImg = k => `/img/c_${k}.webp`;
/* 말은 "이건 두꺼비야"(toad) 와 "이건 두꺼비가 아니야"(!toad) 두 꼴 */
const isNeg = cl => typeof cl === 'string' && cl[0] === '!';
const baseOf = cl => (isNeg(cl) ? cl.slice(1) : cl);
const claimImg = cl => (baseOf(cl) === 'royal' ? '/img/k_roach.webp' : faceImg(baseOf(cl)));
const backImg = () => (S && S.cfg.edition === 'royal' ? '/img/rback.webp' : '/img/back.webp');
const cardName = c => (!c ? '' : c.r ? `왕 ${NAMES[c.k]}` : NAMES[c.k]);
/** 카드 한 장 — 그림 위 아래쪽 이름 띠에 이름을 얹는다 */
const cardFace = (c, cls = '') => `<span class="cardf ${cls}${c && c.k === 'black' ? ' dark' : ''}"><img src="${cardImg(c)}" alt="${cardName(c)}"><span class="cname">${c ? (c.r ? NAMES[c.k] : cardName(c)) : ''}</span></span>`;
/** 조사 — 받침이 있으면 a, 없으면 b */
const josa = (w, a, b) => { const ch = String(w).charCodeAt(String(w).length - 1); return (ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28) ? a : b; };
/** "두꺼비야" / "두꺼비가 아니야" */
const claimSay = cl => { const w = NAMES[baseOf(cl)]; return isNeg(cl) ? `${w}${josa(w, '이', '가')} 아니야` : `${w}${josa(w, '이야', '야')}`; };
/** 짧게 — "두꺼비" / "두꺼비 아님" */
const claimName = cl => (isNeg(cl) ? `${NAMES[baseOf(cl)]} 아님` : NAMES[cl]);

/* 모든 그림을 미리 받아 둔다 — 카드가 처음 뒤집힐 때 빈 칸이 보이지 않게 */
(() => {
  const list = ['back', 'rback', 'front', 'card_subject', 'card_blank'];
  for (const k of ALL_KINDS) list.push(`card_${k}`, `c_${k}`);
  for (const k of ALL_KINDS.slice(0, 7)) list.push(`card_k_${k}`, `k_${k}`);
  setTimeout(() => list.forEach(n => { const i = new Image(); i.src = `/img/${n}.webp`; }), 600);
})();

/* ─────────────────────────── 상태 ─────────────────────────── */

let ws = null;
let me = null;
let S = null;
let skew = 0;
let specId = null, specCtx = null, specRejoin = false;
const isSpec = () => !!S && S.role === 'spec';
const store = window.sessionStorage;
const ls = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} } };

window.__S = () => S;
/* 계측용 — 상태를 손으로 넣어 화면을 멈춰 놓고 본다 (?qa 로 들어올 때만) */
let qaHold = false;
if (new URLSearchParams(location.search).has('qa')) window.__feed = m => { qaHold = true; handle(m); };

/* ─────────────────────────── 소리 ───────────────────────────
   소리 파일 없이 WebAudio 로 그때그때 만든다. 음소거는 기기에 남는다. */

let muted = ls.get('roach.mute') === '1';
let actx = null;
function ac() {
  if (muted) return null;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
  } catch (_) { return null; }
}
function tone(f, t0, dur, type = 'sine', vol = .12, f2) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, c.currentTime + t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, c.currentTime + t0 + dur);
  g.gain.setValueAtTime(0, c.currentTime + t0);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + t0 + .01);
  g.gain.exponentialRampToValueAtTime(.0008, c.currentTime + t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + .05);
}
function noise(t0, dur, vol = .15, freq = 2400) {
  const c = ac(); if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = .8;
  const g = c.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(c.destination);
  s.start(c.currentTime + t0);
}
const sfx = {
  slide: () => noise(0, .22, .18, 1800),
  flip: () => { noise(0, .08, .25, 3200); tone(520, .02, .08, 'triangle', .05); },
  good: () => { tone(660, 0, .18, 'triangle', .1); tone(880, .1, .22, 'triangle', .1); tone(1320, .2, .3, 'sine', .06); },
  bad: () => { tone(220, 0, .3, 'sawtooth', .05, 140); tone(180, .12, .35, 'square', .03, 110); },
  turn: () => { tone(988, 0, .12, 'sine', .08); tone(1318, .09, .18, 'sine', .07); },
  pop: () => tone(740, 0, .07, 'triangle', .07, 980),
  lose: () => { [523, 494, 466, 440].forEach((f, i) => tone(f, i * .18, .26, 'triangle', .08)); },
};
function syncMute() {
  $$('[data-mute]').forEach(b => { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기'); });
}
$$('[data-mute]').forEach(b => b.onclick = () => { muted = !muted; ls.set('roach.mute', muted ? '1' : '0'); syncMute(); if (!muted) sfx.pop(); });
syncMute();

/* ─────────────────────────── 접속 (로보77 과 같다) ─────────────────────────── */

let pingT = null, resting = false, wokeUp = false, restWhy = 0;

function resume() {
  connect(() => {
    const code = store.getItem('code'), token = store.getItem('token');
    if (code && token) send({ t: 'resume', code, token });
  });
}

function wake(e) {
  if (!resting) return;
  if (e.type === 'visibilitychange' && (document.hidden || restWhy === 4001)) return;
  resting = false;
  $('#toast').classList.remove('on');
  if (store.getItem('code') && store.getItem('token')) { wokeUp = true; resume(); }
  else if (specCtx) rejoinSpec();
  else if (watching) watchRooms(true);
}
['pointerdown', 'keydown'].forEach(t => addEventListener(t, wake, true));
document.addEventListener('visibilitychange', wake);

function connect(onOpen) {
  if (ws && ws.readyState === 1) { onOpen && onOpen(); return; }
  if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; try { ws.close(); } catch (_) {} }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    if (sock !== ws) return;
    clearInterval(pingT);
    pingT = setInterval(() => send({ t: 'ping' }), 25_000);
    onOpen && onOpen();
  };
  ws.onmessage = e => {
    if (sock !== ws || qaHold) return;
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.t === 'moved' || m.t === 'idle') {
      sock.why = m.t;
      sock.onclose({ code: m.t === 'moved' ? 4001 : 4000 });
      ws = null;
      try { sock.close(); } catch (_) {}
      return;
    }
    handle(m);
  };
  ws.onclose = e => {
    if (sock !== ws) return;
    clearInterval(pingT);
    const code = sock.why === 'moved' ? 4001 : sock.why === 'idle' ? 4000 : e.code;
    if (code === 4000 || code === 4001) {
      resting = true; restWhy = code;
      const t = $('#toast');
      t.textContent = code === 4000
        ? '한동안 조작이 없어서 연결을 쉬고 있어요. 아무 곳이나 누르면 다시 붙어요.'
        : '다른 창에서 이 자리를 이어받았어요. 여기서 계속하려면 아무 곳이나 누르세요.';
      t.classList.add('on');
      clearTimeout(toastT);
      return;
    }
    if (watching && !store.getItem('code')) {
      setTimeout(() => { if (watching && (!ws || ws.readyState > 1)) watchRooms(true); }, 3000);
    } else if (store.getItem('code') && store.getItem('token')) {
      toast('연결이 끊겼어요. 다시 붙는 중…');
      setTimeout(() => connect(() => send({ t: 'resume', code: store.getItem('code'), token: store.getItem('token') })), 1200);
    } else if (specCtx) {
      toast('연결이 끊겼어요. 다시 붙는 중…');
      setTimeout(() => { if (specCtx && (!ws || ws.readyState > 1)) rejoinSpec(); }, 1200);
    } else {
      show('title');
    }
  };
}

function rejoinSpec() {
  if (!specCtx) return;
  specRejoin = true;
  connect(() => send({ t: 'join', code: specCtx.code, name: specCtx.name }));
}

const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

let leaving = false;
function handle(m) {
  if (leaving) {
    if (m.t !== 'left' && m.t !== 'err') return;
    leaving = false;
    if (m.t === 'err') return;
  }
  switch (m.t) {
    case 'welcome':
      wokeUp = false; entering = 0;
      if (m.code !== chatRoom) { chatRoom = m.code; chatReset(); }
      specRejoin = false;
      if (m.role === 'spec') {
        me = null; specId = m.specId;
        specCtx = { code: m.code, name: myName() };
        store.removeItem('code'); store.removeItem('token');
        history.replaceState(null, '', `?r=${m.code}`);
        break;
      }
      me = m.you;
      specId = null; specCtx = null;
      store.setItem('code', m.code);
      store.setItem('token', m.token);
      history.replaceState(null, '', `?r=${m.code}`);
      if (m.seated) toast('자리가 났어요 — 이제 같이 해요');
      break;

    case 'chat':
      addChat(m.spec ? `${m.name} (관전)` : m.name, m.text, m.from === (me != null ? me : specId));
      break;

    case 'rooms':
      if (watching) renderRooms(m.list);
      break;

    case 'state': {
      const prev = S;
      countGame(m);
      S = m;
      me = m.role === 'spec' ? null : (m.you != null ? m.you : me);
      if (m.now) skew = m.now - Date.now();
      render(prev);
      break;
    }

    case 'ev':
      onEvent(m);
      break;

    case 'react':
      floatEmo(m.from, m.e);
      break;

    case 'err':
      entering = 0;
      toast(m.fatal && wokeUp ? '오래 비워 둔 사이 테이블이 정리됐어요. 새로 열어 주세요.' : m.msg);
      if (m.fatal) { store.removeItem('code'); store.removeItem('token'); specCtx = null; specId = null; show('title'); }
      else if (specRejoin) { specRejoin = false; specCtx = null; specId = null; show('title'); }
      wokeUp = false;
      break;

    case 'left':
      store.removeItem('code'); store.removeItem('token');
      specCtx = null; specId = null;
      history.replaceState(null, '', location.pathname);
      show('title');
      break;
  }
}

/* ─────────────────────────── 화면 ─────────────────────────── */

let screen = 'title';
function show(id) {
  screen = id;
  $$('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  document.body.classList.toggle('in-game', id === 'game');
  if ((id === 'setup') !== watching) watchRooms(id === 'setup');
  if (id === 'title' || id === 'setup') { chatRoom = null; chatReset(); $('#chatBtn').hidden = true; $('#hist').hidden = true; }
}

let toastT = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 2600);
}

const playerOf = id => (S ? S.players.find(p => p.id === id) : null);
const nameOf = id => { const p = playerOf(id); return p ? (p.id === me ? '나' : p.name) : '?'; };
/** "OO가" / "OO이" — 나는 "내가" */
const who = (id, a = '이', b = '가') => (id === me ? (a === '이' ? '내가' : '나' + b) : `${esc(nameOf(id))}${josa(nameOf(id), a, b)}`);

/* ─────────────────────────── 채팅 (로보77 과 같다) ─────────────────────────── */

let chatUnread = 0, chatRoom = null, chatAway = 0, chatPeekT = 0;
const chatTitle0 = document.title;

function chatReset() {
  $('#chatLog').textContent = '';
  $('#chat').hidden = true;
  chatUnread = 0; chatBadge(); chatPeekOff();
  chatAway = 0; chatTitle();
}
function chatOpen(on) {
  $('#chat').hidden = !on;
  if (!on) return;
  chatUnread = 0; chatBadge(); chatPeekOff();
  $('#chatText').focus();
  const log = $('#chatLog'); log.scrollTop = log.scrollHeight;
}
function addChat(name, text, mine) {
  const log = $('#chatLog');
  const d = document.createElement('p');
  d.className = 'chat-msg' + (mine ? ' mine' : '');
  d.innerHTML = `<b>${esc(name)}</b>${esc(text)}`;
  log.appendChild(d);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  if (mine) return;
  if ($('#chat').hidden) { chatUnread++; chatBadge(); chatPeek(name, text); }
  if (document.hidden || !document.hasFocus()) { chatAway++; chatTitle(); }
}
function chatBadge() {
  const n = $('#chatN');
  n.textContent = chatUnread > 99 ? '99+' : chatUnread;
  n.hidden = !chatUnread;
  if (!chatUnread) return;
  n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
}
function chatPeek(name, text) {
  const p = $('#chatPeek');
  p.innerHTML = `<b>${esc(name)}</b>${esc(text)}`;
  p.classList.remove('bye'); p.hidden = false;
  p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
  clearTimeout(chatPeekT);
  chatPeekT = setTimeout(() => { p.classList.add('bye'); chatPeekT = setTimeout(chatPeekOff, 260); },
    Math.min(6000, Math.max(3000, 1200 + 70 * text.length)));
}
function chatPeekOff() { clearTimeout(chatPeekT); const p = $('#chatPeek'); p.hidden = true; p.classList.remove('bye'); }
function chatTitle() { document.title = (chatAway ? `(${chatAway > 99 ? '99+' : chatAway}) ` : '') + chatTitle0; }
function chatBack() { if (chatAway && !document.hidden && document.hasFocus()) { chatAway = 0; chatTitle(); } }
document.addEventListener('visibilitychange', chatBack);
window.addEventListener('focus', chatBack);
function syncChatVisible() {
  const humans = S ? S.players.filter(p => !p.bot).length + (S.specs ? S.specs.length : 0) : 0;
  const on = humans > 1;
  $('#chatBtn').hidden = !on;
  if (!on) { $('#chat').hidden = true; chatPeekOff(); }
  else $('#chatWho').textContent = `${humans}명`;
}
$('#chatBtn').onclick = () => chatOpen($('#chat').hidden);
$('#chatPeek').onclick = () => chatOpen(true);
$('#chatX').onclick = () => chatOpen(false);
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const box = $('#chatText');
  const text = box.value.trim();
  if (!text) return;
  send({ t: 'chat', text });
  box.value = '';
});

/* ─────────────────────────── 그리기 ─────────────────────────── */

let gameAt = 0;
function countGame(m) {
  if (m.role === 'spec') { if (window.norara && norara.live) norara.live(false); return; }
  const my = m.you != null ? m.you : me;
  if (window.norara && norara.live) norara.live(m.phase === 'playing');
  if (!window.norara || !m.players || m.hostId !== my) return;
  const humans = m.players.filter(p => !p.bot).length;
  if (m.phase === 'playing' && (!S || S.phase !== 'playing')) {
    gameAt = Date.now();
    norara.ev('start', { n: humans, ed: m.cfg.edition });
  } else if (m.phase === 'over' && (!S || S.phase !== 'over') && gameAt) {
    norara.ev('end', { n: humans, sec: Math.round((Date.now() - gameAt) / 1000) });
    gameAt = 0;
  }
}

function render(prev) {
  if (!S) return;
  document.body.classList.toggle('spec', isSpec());
  document.body.classList.toggle('royal-ed', S.cfg.edition === 'royal');
  syncChatVisible();
  if (S.phase === 'lobby') { show('lobby'); renderLobby(); }
  else if (S.phase === 'playing') { if (screen !== 'game') { show('game'); dealt = true; } renderGame(prev); }
  else if (S.phase === 'over') {
    if (prev && prev.phase === 'playing') {
      // 마지막 카드가 앞에 놓이는 것까지 보고 나서 결과 화면으로
      renderGame(prev);
      sfx.lose();
      setTimeout(() => { if (S.phase === 'over') { show('over'); renderOver(); } }, 1600);
    } else { show('over'); renderOver(); }
  }
}

/* ── 대기실 ── */

let facePicking = false;

function edBadge(ed) {
  return ed === 'royal'
    ? '<span class="ed-badge"><img src="/img/rback.webp" alt=""><span><b>로얄판</b> <small>왕 · 신하 · 검은 카드</small></span></span>'
    : '<span class="ed-badge"><img src="/img/back.webp" alt=""><span><b>기본판</b> <small>생물 8종 × 8장</small></span></span>';
}

function renderLobby() {
  $('#lCode').textContent = S.code;
  const spec = isSpec();
  $('#lCount').textContent = `${S.players.length} / ${S.max}명` + (S.cfg.priv ? ' · 비공개' : '')
    + (S.specs && S.specs.length ? ` · 관전 ${S.specs.length}명` : '');
  $('#lSpecNote').hidden = !spec;
  $('#lEdShow').innerHTML = edBadge(S.cfg.edition);
  // 지금 인원이면 어떤 규칙인지 — 2인은 원작 규칙서의 2인 규칙이 따로 있다
  const n = S.players.length;
  $('#lRule').innerHTML = n < 2 ? '두 명 이상이면 시작할 수 있어요' : `${n}명이면 — 같은 생물 <b>${S.loseAt}장</b>이면 패배`
    + (S.canPass ? ' · 몰래 보고 넘기기 있음' : ' · <b>넘기기 없음</b>')
    + (S.removed ? ` · 카드 <b>${S.removed}장</b>은 빼 두고 시작` : '')
    + (S.cfg.edition === 'royal' ? ` · 벌칙 더미 <b>${n === 2 ? 16 : 7}장</b>` : '');
  const isHost = !spec && S.hostId === me;

  const ul = $('#lPlayers');
  let html = '';
  for (const p of S.players) {
    const mine = p.id === me;
    html += `<li class="seat-card${mine ? ' mine' : ''}" data-id="${p.id}">
      <div class="face"${mine ? ' data-face title="얼굴 바꾸기"' : ''}><img src="${faceImg(p.face)}" alt="${NAMES[p.face]}"></div>
      <span class="nm">${esc(p.name)}</span>
      <span class="badges">${p.id === S.hostId ? '<span class="badge host">방장</span>' : ''}${p.bot ? '<span class="badge">봇</span>' : ''}${!p.bot && !p.connected ? '<span class="badge off">끊김</span>' : ''}${mine ? '<span class="badge">나</span>' : ''}</span>
      ${isHost && p.id !== S.hostId ? `<button class="kick" data-kick="${p.id}" title="내보내기">✕</button>` : ''}
    </li>`;
  }
  for (let i = S.players.length; i < S.max; i++) html += '<li class="seat-card empty">빈 자리</li>';
  if (facePicking && !spec) {
    const used = new Set(S.players.filter(p => p.id !== me).map(p => p.face));
    html += `<li class="face-pick" style="grid-column:1/-1">${ALL_KINDS.map(k =>
      `<button data-pick="${k}"${used.has(k) ? ' disabled' : ''} title="${NAMES[k]}"><img src="${faceImg(k)}" alt="${NAMES[k]}"></button>`).join('')}</li>`;
  }
  ul.innerHTML = html;
  $('#lFaceHint').hidden = spec;

  $('#lHostBox').classList.toggle('hidden', !isHost);
  $('#lWait').classList.toggle('hidden', isHost);
  $('#lWait').textContent = spec ? '관전 대기 중 — 방장이 시작하면 구경하고, 자리가 나면 같이 해요' : '방장이 시작하기를 기다리는 중';

  $$('#edPick button').forEach(b => b.classList.toggle('on', b.dataset.ed === S.cfg.edition));
  $('#tPriv').setAttribute('aria-checked', String(!!S.cfg.priv));
  $('#tSpec').setAttribute('aria-checked', String(S.cfg.spec !== false));
  $$('#segTime button').forEach(b => b.classList.toggle('on', Number(b.dataset.ms) === S.cfg.turnLimit));
  if (!isHost) return;
  $('#bStart').disabled = S.players.length < S.min;
  $('#bBot').disabled = S.players.length >= S.max;
}

$('#lPlayers').addEventListener('click', e => {
  const k = e.target.closest('[data-kick]');
  if (k) return send({ t: 'kick', id: Number(k.dataset.kick) });
  const pk = e.target.closest('[data-pick]');
  if (pk) { facePicking = false; send({ t: 'face', face: pk.dataset.pick }); sfx.pop(); return; }
  if (e.target.closest('[data-face]')) { facePicking = !facePicking; renderLobby(); }
});

/* ── 게임 ── */

let sel = { pile: null, ids: [], to: null, claim: null };   // 내가 고르는 중인 것
let selKey = '';                                             // 무엇을 고르는 단계인가 — 바뀌면 고른 것을 비운다
let dealt = false;
let revealKey = '';
let lastFx = 0;
let prevRows = {};

function resetSel() { sel = { pile: null, ids: [], to: null, claim: null, neg: false }; }

/** 지금 내가 해야 하는 일 */
function myMode() {
  if (!S || S.phase !== 'playing' || isSpec() || S.reveal) return null;
  if (S.tribute) return S.tribute.who === me ? 'tribute' : null;
  if (S.chain) {
    if (S.chain.to !== me) return null;
    return S.chain.step === 'pass' ? 'pass' : 'decide';
  }
  return S.starter === me ? 'give' : null;
}
function actorId() {
  if (!S || S.phase !== 'playing' || S.reveal) return null;
  if (S.tribute) return S.tribute.who;
  return S.chain ? S.chain.to : S.starter;
}

/** 상대 자리 — 내 다음 사람부터 자리 순서대로, 넓은 화면에서는 위쪽 호를 따라 */
function oppOrder() {
  const list = S.players.slice();
  const i = list.findIndex(p => p.id === me);
  return i >= 0 ? list.slice(i + 1).concat(list.slice(0, i)) : list;
}

function rowHTML(p, big) {
  const kinds = S.kinds || ALL_KINDS;
  const prev = prevRows[p.id] || {};
  let h = '';
  for (const k of kinds) {
    const n = p.row[k] || 0;
    if (!n) continue;
    const cls = n >= S.loseAt ? ' dead' : n === S.loseAt - 1 ? ' warn' : '';
    const pop = n > (prev[k] || 0) ? ' pop' : '';
    const cr = p.crowns && p.crowns[k] ? `<span class="cr">👑</span>` : '';
    h += `<span class="tok${cls}${pop}" title="${NAMES[k]} ${n}장" data-k="${k}">${cr}<img src="${faceImg(k)}" alt=""><span class="n">${n}</span></span>`;
  }
  return h;
}

const RING_R = 26, RING_C = 2 * Math.PI * RING_R;
const ringSVG = `<svg class="ring" viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="${RING_R}"/><circle class="fg" cx="30" cy="30" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg>`;

function renderSeats(mode) {
  const opps = oppOrder();
  const box = $('#opps');
  const wide = innerWidth > 760;
  const n = opps.length;
  const pickIds = mode === 'give' ? opps.map(p => p.id) : mode === 'pass' ? S.chain.targets : [];
  const act = actorId();
  let html = '';
  opps.forEach((p, i) => {
    // 위쪽 호: 왼쪽(190°)에서 오른쪽(350°)까지 고르게. 한 명이면 한가운데 위
    const a = n === 1 ? 270 : 190 + (160 * i) / (n - 1);
    // 양 끝 자리가 화면 밖으로 잘리지 않게 안쪽으로 붙인다
    const tw = box.clientWidth || innerWidth, half = 84 / tw * 100 + 0.8;
    const x = Math.min(100 - half, Math.max(half, 50 + 41 * Math.cos(a * Math.PI / 180)));
    const y = 47 + 37 * Math.sin(a * Math.PI / 180);
    const cls = ['seat'];
    if (p.id === act) cls.push('now');
    if (pickIds.includes(p.id)) cls.push('pickable');
    if (sel.to === p.id && pickIds.includes(p.id)) cls.push('picked');
    if (S.chain && S.chain.seen.includes(p.id) && S.chain.to !== p.id) cls.push('seen');
    html += `<div class="${cls.join(' ')}" data-seat="${p.id}" style="${wide ? `--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%` : ''}">
      <div class="seat-top">
        <span class="av">${p.id === act ? ringSVG : ''}<img src="${faceImg(p.face)}" alt=""></span>
        <div class="seat-id">
          <p class="seat-nm">${esc(p.name)}</p>
          <p class="seat-sub"><i class="mini-back"></i>${p.hand}장${!p.bot && !p.connected ? ' <span class="dc">끊김</span>' : ''}</p>
        </div>
      </div>
      <div class="row">${rowHTML(p)}</div>
    </div>`;
  });
  box.innerHTML = html;
}

function renderMe(mode) {
  const zone = $('#meZone');
  const mine = playerOf(me);
  zone.hidden = !mine;
  if (!mine) return;
  const act = actorId() === me;
  zone.classList.toggle('now', act);
  $('#meAv').innerHTML = (act ? ringSVG : '') + `<img src="${faceImg(mine.face)}" alt="">`;
  $('#meName').textContent = mine.name + ' (나)';
  $('#meSub').textContent = `손에 ${mine.hand}장`;
  $('#meRow').innerHTML = rowHTML(mine, true);
}

/** 손패 — 같은 카드끼리 더미로 */
function piles() {
  const m = new Map();
  for (const c of S.hand) {
    const key = c.k + (c.r ? '*' : '');
    if (!m.has(key)) m.set(key, { key, card: c, ids: [] });
    m.get(key).ids.push(c.id);
  }
  return [...m.values()];
}

function renderHand(mode) {
  const box = $('#hand');
  $('#handWrap').hidden = isSpec();
  if (isSpec()) return;
  const ps = piles();
  box.classList.toggle('choose', mode === 'give' || mode === 'tribute');
  if (!ps.length) { box.innerHTML = '<p class="hand-empty">손에 카드가 없어요</p>'; return; }
  const trib = mode === 'tribute';
  box.innerHTML = ps.map((p, i) => {
    const special = p.card.k === 'subject' || p.card.k === 'black';
    const n = p.ids.length;
    let cls = 'pile';
    if (mode === 'give' && sel.pile === p.key) cls += ' sel';
    if (trib) {
      const picked = p.ids.filter(id => sel.ids.includes(id)).length;
      if (picked) cls += ' sel2';
      if (special) cls += ' dim';
    }
    if (dealt) cls += ' dealt';
    const unders = (n > 2 ? `<img class="under2" src="${cardImg(p.card)}" alt="">` : '') + (n > 1 ? `<img class="under" src="${cardImg(p.card)}" alt="">` : '');
    const pickedN = trib ? p.ids.filter(id => sel.ids.includes(id)).length : 0;
    return `<button class="${cls}" data-pile="${p.key}" style="--dl:${i * 60}ms" title="${cardName(p.card)} ${n}장">
      ${unders}${cardFace(p.card, 'top')}<span class="cnt">${pickedN ? `${pickedN}/` : ''}${n}</span></button>`;
  }).join('');
  dealt = false;
}

$('#hand').addEventListener('click', e => {
  const b = e.target.closest('[data-pile]');
  if (!b || !S) return;
  const mode = myMode();
  const p = piles().find(x => x.key === b.dataset.pile);
  if (!p) return;
  if (mode === 'give') {
    sel.pile = sel.pile === p.key ? null : p.key;
    sfx.pop();
    renderGame();
  } else if (mode === 'tribute') {
    if (p.card.k === 'subject' || p.card.k === 'black') return toast('특수 카드는 내려놓을 수 없어요.');
    // 더미를 누를 때마다 한 장씩 더 고르고, 다 고른 더미를 또 누르면 그 더미에서 고른 걸 거둔다
    const picked = p.ids.filter(id => sel.ids.includes(id));
    if (picked.length < p.ids.length && sel.ids.length < 2) sel.ids.push(p.ids.find(id => !sel.ids.includes(id)));
    else sel.ids = sel.ids.filter(id => !p.ids.includes(id));
    sfx.pop();
    renderGame();
  } else if (mode) {
    toast(mode === 'decide' ? '받은 카드를 어떻게 할지 먼저 골라요.' : '몰래 본 카드를 넘길 차례예요.');
  }
});

$('#opps').addEventListener('click', e => {
  const s = e.target.closest('.seat.pickable');
  if (!s) return;
  sel.to = Number(s.dataset.seat);
  sfx.pop();
  renderGame();
});

function claimsHTML() {
  const neg = !!sel.neg;
  return `<div class="say-mode" role="radiogroup" aria-label="말하는 꼴">
      <button class="${neg ? '' : 'on'}" data-neg="0">“이건 ○○야”</button>
      <button class="${neg ? 'on' : ''}" data-neg="1">“이건 ○○가 아니야”</button>
    </div>
    <div class="claims${neg ? ' negs' : ''}">${S.claims.map(cl => {
      const full = (neg ? '!' : '') + cl;
      return `<button class="claim-b${cl === 'royal' ? ' royal' : ''}${neg ? ' neg' : ''}${sel.claim === full ? ' on' : ''}" data-claim="${full}"><span class="ci"><img src="${claimImg(cl)}" alt=""></span>${NAMES[cl]}</button>`;
    }).join('')}</div>`;
}

function tributeValid() {
  if (!S.tribute) return false;
  const opts = S.hand.filter(c => c.k !== 'subject' && c.k !== 'black');
  const cards = sel.ids.map(id => opts.find(c => c.id === id)).filter(Boolean);
  const plain = (c, cl) => (c.r ? (cl === c.k || cl === 'royal') : cl === c.k);
  const match = c => c.k !== 'subject' && c.k !== 'black' && (isNeg(S.tribute.claim) ? !plain(c, baseOf(S.tribute.claim)) : plain(c, S.tribute.claim));
  if (opts.length < 2) return cards.length === opts.length;
  if (cards.length === 1) return match(cards[0]);
  return cards.length === 2;
}

function renderAct(mode) {
  const box = $('#act'), t = $('#actTitle'), body = $('#actBody');
  box.hidden = !mode;
  if (!mode) return;
  if (mode === 'give') {
    const s1 = !!sel.pile, s2 = !!sel.to, s3 = !!sel.claim;
    t.innerHTML = '내 차례 — 카드를 엎어서 내미세요<small>진짜를 말해도, 거짓말을 해도 좋아요</small>';
    body.innerHTML = `
      <div class="steps-line"><span class="${s1 ? 'done' : 'on'}">① 손에서 카드</span><span class="${s2 ? 'done' : s1 ? 'on' : ''}">② 받을 사람 (위 자리 누르기)</span><span class="${s3 ? 'done' : s1 && s2 ? 'on' : ''}">③ 뭐라고 말할까</span></div>
      ${claimsHTML()}
      <div class="act-row"><button class="btn gold" id="bGive" ${s1 && s2 && s3 ? '' : 'disabled'}>${s1 && s2 && s3 ? `${esc(nameOf(sel.to))}에게 “${claimSay(sel.claim)}” 하고 내밀기` : '내밀기'}</button></div>`;
  } else if (mode === 'decide') {
    const c = S.chain;
    const can = c.targets.length > 0;
    t.innerHTML = `${esc(nameOf(c.from))}: “이건 <span style="color:var(--gold-hi)">${claimSay(c.claim)}</span>”<small>믿을까, 의심할까, 몰래 보고 남에게 넘길까</small>`;
    body.innerHTML = `<div class="chips">
      <button class="chip ok" data-call="1"><img src="/img/chip_ok.webp" alt=""><span>진짜다</span><small>${isNeg(c.claim) ? `정말 ${NAMES[baseOf(c.claim)]} 아니야` : `${NAMES[c.claim]} 맞아`}</small></button>
      <button class="chip no" data-call="0"><img src="/img/chip_no.webp" alt=""><span>거짓말!</span><small>${isNeg(c.claim) ? `사실 ${NAMES[baseOf(c.claim)]}${josa(NAMES[baseOf(c.claim)], '이야', '야')}` : `${NAMES[c.claim]} 아니야`}</small></button>
      <button class="chip peek" id="bPeek" ${can ? '' : 'disabled'}><img src="/img/chip_peek.webp" alt=""><span>몰래 보고 넘기기</span><small>${can ? `${c.targets.length}명에게 넘길 수 있음` : S.canPass ? '모두 이미 본 카드' : '2인은 넘기기 없음'}</small></button>
    </div>`;
  } else if (mode === 'pass') {
    const c = S.chain;
    const s2 = !!sel.to, s3 = !!sel.claim;
    t.innerHTML = `몰래 본 카드는 <span style="color:var(--gold-hi)">${cardName(c.card)}</span> — 누구에게 뭐라고 넘길까요<small>아직 이 카드를 안 본 사람에게만 넘길 수 있어요</small>`;
    body.innerHTML = `
      <div class="steps-line"><span class="${s2 ? 'done' : 'on'}">① 받을 사람 (빛나는 자리)</span><span class="${s3 ? 'done' : s2 ? 'on' : ''}">② 뭐라고 말할까</span></div>
      ${claimsHTML()}
      <div class="act-row"><button class="btn gold" id="bPass" ${s2 && s3 ? '' : 'disabled'}><img src="/img/chip_pass.webp" alt="" style="width:22px;vertical-align:-5px;margin-right:6px">${s2 && s3 ? `${esc(nameOf(sel.to))}에게 “${claimSay(sel.claim)}” 하고 넘기기` : '넘기기'}</button></div>`;
  } else if (mode === 'tribute') {
    const tr = S.tribute;
    const cn = tr.card === 'black' ? '검은 카드' : '신하 카드';
    t.innerHTML = tr.fromPenalty ? `벌칙 더미에서 ${cn}${josa(cn, '이', '가')} 나왔어요! 손으로 가져가는 대신…` : `${cn}${josa(cn, '을', '를')} 떠안았어요! 손으로 가져가는 대신…`;
    body.innerHTML = `<p class="hint-line"><b style="color:var(--ink)">“${claimSay(tr.claim)}”에 맞는 카드 1장</b>, 또는 <b style="color:var(--ink)">아무 카드 2장</b>을 손패에서 눌러 앞에 내려놓으세요 · ${sel.ids.length}장 고름</p>
      <div class="act-row"><button class="btn gold" id="bTrib" ${tributeValid() ? '' : 'disabled'}>내려놓기</button></div>`;
  }
}

$('#actBody').addEventListener('click', e => {
  const cl = e.target.closest('[data-claim]');
  if (cl) { sel.claim = cl.dataset.claim; sfx.pop(); return renderGame(); }
  const ng = e.target.closest('[data-neg]');
  if (ng) {
    sel.neg = ng.dataset.neg === '1';
    if (sel.claim) sel.claim = (sel.neg ? '!' : '') + baseOf(sel.claim);   // 고른 생물은 그대로 두고 꼴만 바꾼다
    sfx.pop(); return renderGame();
  }
  const ch = e.target.closest('[data-call]');
  if (ch) { send({ t: 'call', sayTrue: ch.dataset.call === '1' }); return; }
  if (e.target.closest('#bPeek')) { send({ t: 'peek' }); sfx.flip(); return; }
  if (e.target.closest('#bGive')) {
    const p = piles().find(x => x.key === sel.pile);
    if (!p || !sel.to || !sel.claim) return;
    send({ t: 'give', card: p.ids[Math.floor(Math.random() * p.ids.length)], to: sel.to, claim: sel.claim });
    resetSel();
    return;
  }
  if (e.target.closest('#bPass')) { if (sel.to && sel.claim) { send({ t: 'pass', to: sel.to, claim: sel.claim }); resetSel(); } return; }
  if (e.target.closest('#bTrib')) { send({ t: 'tribute', ids: sel.ids.slice() }); resetSel(); }
});

/** 한가운데 — 오가는 카드, 말풍선, 판정 */
function renderStage(prev) {
  const flip = $('#flip'), bubble = $('#bubble'), verdict = $('#verdict'), path = $('#path'), status = $('#status');
  const R = S.reveal, c = S.chain;
  $('#flipBack').src = backImg();

  // 벌칙 더미
  const pen = $('#penalty');
  pen.hidden = !S.penalty;
  if (S.penalty) {
    $('#penTop').innerHTML = S.penalty.top ? `<img src="${cardImg(S.penalty.top)}" alt="${cardName(S.penalty.top)}" title="벌칙 더미 윗장: ${cardName(S.penalty.top)}">` : '';
    $('#penN').textContent = `벌칙 더미 ${S.penalty.n}장`;
  }

  const hops = (R ? R.path : c ? c.path : []) || [];
  path.innerHTML = hops.length > 1 ? hops.map((h, i) =>
    `${i ? '<span class="arr">›</span>' : ''}<span class="hop">${esc(nameOf(h.from))} → ${esc(nameOf(h.to))} <b>${claimName(h.claim)}</b></span>`).join('') : '';

  if (R) {
    const key = JSON.stringify([R.caller, R.passer, R.claim, R.card, S.history.length]);
    $('#flipFront').innerHTML = cardFace(R.card);
    flip.classList.add('on', 'big'); flip.classList.remove('wobble');
    if (key !== revealKey) {
      revealKey = key;
      flip.classList.remove('open');
      verdict.hidden = true;
      setTimeout(() => { flip.classList.add('open'); sfx.flip(); }, 380);
      setTimeout(() => {
        verdict.hidden = false;
        const iWon = R.taker !== me && (R.caller === me || R.passer === me);
        const iLost = R.taker === me;
        if (iLost) sfx.bad(); else if (iWon) sfx.good(); else (R.right ? sfx.good : sfx.bad)();
      }, 1050);
    }
    bubble.hidden = false;
    bubble.innerHTML = `<small>${esc(nameOf(R.passer))} → ${esc(nameOf(R.caller))}</small>“이건 <span class="claim">${claimSay(R.claim)}</span>”<span class="said ${R.sayTrue ? 'yes' : 'no'}">${esc(nameOf(R.caller))}: ${R.sayTrue ? '진짜다!' : '거짓말!'}</span>`;
    verdict.className = 'verdict ' + (R.right ? 'right' : 'wrong');
    verdict.innerHTML = `<span class="v-big">${who(R.caller)} ${R.right ? '맞혔다!' : '틀렸다!'}</span>
      <small>정체는 <b>${cardName(R.card)}</b>${R.truth ? ' — 진짜였다' : ' — 거짓말이었다'} · ${who(R.taker)} 가져간다</small>`;
    status.innerHTML = '';
    return;
  }
  revealKey = '';
  verdict.hidden = true;

  if (c) {
    flip.classList.add('on'); flip.classList.remove('big');
    const known = c.card;
    $('#flipFront').innerHTML = known ? cardFace(known) : '';
    flip.classList.toggle('open', !!known);
    flip.classList.toggle('wobble', !known);
    bubble.hidden = false;
    bubble.innerHTML = `<small>${esc(nameOf(c.from))} → ${esc(nameOf(c.to))}</small>“이건 <span class="claim">${claimSay(c.claim)}</span>”`
      + (known && c.to !== me ? `<small style="margin-top:4px">나만 아는 정체: <b>${cardName(known)}</b></small>` : '');
    if (c.to === me) status.innerHTML = '';
    else status.innerHTML = c.step === 'pass'
      ? `${who(c.to)} 몰래 보고 누구에게 넘길지 고르는 중`
      : `${who(c.to)} 믿을지 말지 고민하는 중…`;
    return;
  }

  flip.classList.remove('on', 'open', 'wobble', 'big');
  bubble.hidden = true;
  if (S.tribute) {
    status.innerHTML = S.tribute.who === me ? '' : `${who(S.tribute.who)} <b>${NAMES[S.tribute.card]}</b> 카드를 떠안고 내려놓을 카드를 고르는 중`;
  } else {
    status.innerHTML = S.starter === me ? '' : `<b>${esc(nameOf(S.starter))}</b> 차례 — 누구에게 무엇을 내밀지 고르는 중`;
  }
}

function renderGame(prev) {
  if (!S || (S.phase !== 'playing' && S.phase !== 'over')) return;
  prev = prev || null;
  const mode = myMode();
  // 해야 할 일이 바뀌면 고르던 것을 비운다
  const key = mode + '|' + (S.chain ? S.chain.path.length + ':' + S.chain.step : '') + '|' + (S.tribute ? 't' : '') + '|' + S.starter;
  if (key !== selKey) { selKey = key; resetSel(); if (prev && (mode === 'give' || mode === 'tribute')) sfx.turn(); }
  if (mode === 'pass' && sel.to && !S.chain.targets.includes(sel.to)) sel.to = null;

  const ed = S.cfg.edition;
  const edp = $('#gEd'); edp.textContent = ed === 'royal' ? '👑 로얄판' : '기본판'; edp.className = 'pill ed ' + ed;
  $('#gLose').textContent = `같은 생물 ${S.loseAt}장이면 패배` + (S.removed ? ` · ${S.removed}장은 빼 두고 시작` : '') + (S.canPass ? '' : ' · 넘기기 없음');
  const sn = $('#gSpecN');
  sn.hidden = !(S.specs && S.specs.length);
  sn.textContent = isSpec() ? '관전 중' : `관전 ${S.specs ? S.specs.length : 0}명`;
  if (isSpec()) sn.hidden = false;

  renderSeats(mode);
  renderMe(mode);
  renderStage(prev);
  renderAct(mode);
  renderHand(mode);
  animateFx(prev);
  renderHist();
  $('#reacts').hidden = isSpec();
  requestAnimationFrame(layoutStage);

  prevRows = {};
  for (const p of S.players) prevRows[p.id] = Object.assign({}, p.row);
}

/* ── 연출: 카드가 날아간다 ── */

function anchorOf(pid) {
  if (pid === me) return $('#meRow').children.length ? $('#meRow') : $('#meAv');
  const s = document.querySelector(`[data-seat="${pid}"]`);
  return s ? (s.querySelector('.av') || s) : null;
}
function flyImg(src, fromEl, toEl, { delay = 0, w = 70 } = {}) {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const img = document.createElement('img');
  img.className = 'flyer'; img.src = src; img.alt = '';
  const h = w * 716 / 480;
  img.style.cssText = `left:${a.left + a.width / 2 - w / 2}px;top:${a.top + a.height / 2 - h / 2}px;width:${w}px;height:${h}px;opacity:0`;
  document.body.appendChild(img);
  setTimeout(() => {
    img.style.opacity = '1';
    requestAnimationFrame(() => {
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
      const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      img.style.transform = `translate(${dx}px,${dy}px) rotate(${(Math.random() * 30 - 15).toFixed(0)}deg) scale(.55)`;
    });
    setTimeout(() => { img.style.opacity = '0'; }, 560);
    setTimeout(() => img.remove(), 900);
  }, delay);
}

function onEvent(m) {
  if (m.kind === 'joined' && m.by !== me) toast('누가 테이블에 앉았어요');
  if (m.kind === 'give') {
    // 내민 사람 자리에서 무대 한가운데로 뒷면이 미끄러진다
    setTimeout(() => {
      flyImg(backImg(), anchorOf(m.by), $('#flip'), { w: 60 });
      sfx.slide();
    }, 0);
    if (m.to === me) setTimeout(sfx.turn, 450);
  }
  if (m.kind === 'peek' && m.by !== me) toast(`${nameOf(m.by)}${josa(nameOf(m.by), '이', '가')} 몰래 카드를 봤어요 👀`);
  if (m.kind === 'timeout' && m.by === me) toast('시간이 지나서 알아서 뒀어요');
}

function animateFx(prev) {
  const fx = S.fx;
  if (!fx || fx.seq === lastFx) return;
  const first = !lastFx && !prev;
  lastFx = fx.seq;
  if (first) return;
  const to = anchorOf(fx.who);
  fx.cards.forEach((c, i) => {
    const from = c.src === 'penalty' ? $('#penTop') : c.src === 'hand' && fx.who === me ? $('#hand') : c.src === 'hand' ? anchorOf(fx.who) : $('#flip');
    flyImg(cardImg(c), from, c.toHand && fx.who === me ? $('#hand') : to, { delay: i * 260, w: 64 });
  });
  if (fx.cards.some(c => c.src === 'penalty')) toast(`👑 왕 카드! ${nameOf(fx.who)}${josa(nameOf(fx.who), '이', '가')} 벌칙 더미에서 한 장 더 가져가요`);
}

/* ── 기록 ── */

function renderHist() {
  const ol = $('#histList');
  if (!S.history || !S.history.length) { ol.innerHTML = '<li style="display:block;color:var(--muted)">아직 뒤집은 카드가 없어요</li>'; return; }
  ol.innerHTML = S.history.map(h => `<li><img src="${cardImg(h.card)}" alt="">
    <span>${esc(nameOf(h.passer))} → ${esc(nameOf(h.caller))} “${claimSay(h.claim)}”<br>
    <span class="${h.right ? 'r' : 'w'}">${esc(nameOf(h.caller))} ${h.right ? '맞힘' : '틀림'}</span> · ${cardName(h.card)} → <b>${esc(nameOf(h.taker))}</b></span></li>`).join('');
}
$('#bHist').onclick = () => { $('#hist').hidden = !$('#hist').hidden; };
$('#histX').onclick = () => { $('#hist').hidden = true; };

/* ── 표정 ── */

function floatEmo(pid, e) {
  const el = anchorOf(pid) || $('#flip');
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'float-emo';
  d.textContent = EMO[e] || '❓';
  d.style.left = `${r.left + r.width / 2}px`;
  d.style.top = `${r.top - 6}px`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 1900);
}
$('#reacts').addEventListener('click', e => {
  const b = e.target.closest('[data-e]');
  if (b) send({ t: 'react', e: Number(b.dataset.e) });
});

/* ── 끝 ── */

function renderOver() {
  const L = playerOf(S.loser);
  const spec = isSpec();
  const iLost = S.loser === me;
  $('#oTitle').textContent = !L ? '게임 끝' : iLost ? '내가 졌다…' : `${L.name} 패배!`;
  const why = S.loseWhy === 'four'
    ? `앞에 ${NAMES[S.loseKind]}${josa(NAMES[S.loseKind], '이', '가')} ${S.loseAt}장 쌓였다`
    : '내밀 카드가 바닥났다';
  $('#oSub').textContent = L ? `${iLost ? '' : L.name + ' — '}${why}. ${iLost ? '나머지는 모두 이겼어요.' : spec ? '나머지는 모두 승리.' : '나는 살아남았어요! 🎉'}` : '';
  $('#oFinal').innerHTML = S.players.slice().sort((a, b) => (b.id === S.loser) - (a.id === S.loser)).map(p => `
    <li class="${p.id === S.loser ? 'loser' : ''}"><span class="av"><img src="${faceImg(p.face)}" alt=""></span>
      <div><b>${esc(p.name)}${p.id === me ? ' (나)' : ''}</b><div class="row">${rowHTML(p)}</div></div>
      <span class="res ${p.id === S.loser ? 'lose' : 'win'}">${p.id === S.loser ? '패배' : '승리'}</span></li>`).join('');
  $('#bAgain').classList.toggle('hidden', spec || S.hostId !== me);
  $('#oWait').textContent = !spec && S.hostId !== me ? '방장이 한 판 더 하기를 기다리는 중' : '';
  $('#oWait').hidden = spec || S.hostId === me;
  $('#oSpecNote').hidden = !spec;
}

/* ─────────────────────────── 타이머 링 ─────────────────────────── */

function tick() {
  requestAnimationFrame(tick);
  if (!S || S.phase !== 'playing' || !S.turnEndsAt) return;
  const fg = document.querySelector('.ring .fg');
  if (!fg) return;
  const total = S.cfg.turnLimit || 1;
  const left = Math.max(0, S.turnEndsAt - (Date.now() + skew));
  const p = Math.min(1, left / total);
  fg.style.strokeDashoffset = String(RING_C * (1 - p));
  fg.classList.toggle('warn', p <= .5 && p > .2);
  fg.classList.toggle('hot', p <= .2);
}
requestAnimationFrame(tick);

/* 넓은 화면 — 무대를 위쪽 자리들 아래 빈 곳 한가운데에 두고, 카드 크기를 남은 높이에 맞춘다.
   할 일 판이 뜨면 테이블이 낮아지는데, 그대로 두면 위쪽 가운데 자리와 카드가 겹친다. */
function layoutStage() {
  const stage = $('#stage'), table = $('#table');
  if (innerWidth <= 760) { stage.style.removeProperty('--st'); stage.style.removeProperty('--cw'); return; }
  const T = table.getBoundingClientRect();
  if (!T.height) return;
  const sw = stage.offsetWidth, sl = T.left + T.width / 2 - sw / 2;
  let topB = 0;
  for (const s of document.querySelectorAll('#opps .seat')) {
    const r = s.getBoundingClientRect();
    if (r.right > sl + 10 && r.left < sl + sw - 10) topB = Math.max(topB, r.bottom - T.top);
  }
  const avail = T.height - topB - 14;
  const big = $('#flip').classList.contains('big');
  const want = (big ? 150 : 116) * 716 / 480;
  const h = Math.max(96, Math.min(want, avail - 6));
  stage.style.setProperty('--cw', Math.round(h * 480 / 716) + 'px');
  stage.style.setProperty('--st', Math.round(topB + 8 + Math.max(avail, h) / 2) + 'px');
}

/* 창 크기가 바뀌면 자리 배치를 다시 */
let rsT = 0;
addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (S && S.phase === 'playing') renderGame(); }, 120); });

/* ─────────────────────────── 조작 ─────────────────────────── */

const myName = () => ($('#gName').value || '').trim().slice(0, 12);

$('#bBegin').onclick = () => { show('setup'); setTimeout(() => $('#gName').focus(), 60); ac(); };
$('#bBack').onclick = () => show('title');

let entering = 0;
function enter(msg) {
  if (Date.now() - entering < 4000) return;
  entering = Date.now();
  store.removeItem('code'); store.removeItem('token');
  ls.set('name', myName());
  connect(() => send(msg));
}
$('#bCreate').onclick = () => enter({ t: 'create', name: myName(), priv: $('#gPriv').checked, spec: $('#gSpec').checked });

function doJoin() {
  const code = ($('#gCode').value || '').trim().toUpperCase();
  if (code.length !== 4) return toast('네 글자 코드를 넣어 주세요.');
  enter({ t: 'join', code, name: myName() });
}
$('#bJoin').onclick = doJoin;

/* 열린 방 (로보77 과 같다) */
let watching = false;
function watchRooms(on) {
  watching = on;
  if (on) connect(() => { if (watching && !store.getItem('code')) send({ t: 'rooms' }); });
  else send({ t: 'unwatch' });
}
document.addEventListener('visibilitychange', () => {
  if (!watching || resting || store.getItem('code') || Date.now() - entering < 4000) return;
  if (document.hidden) {
    if (!ws) return;
    const s = ws; ws = null;
    s.onopen = s.onmessage = s.onclose = null;
    clearInterval(pingT);
    try { s.close(); } catch (_) {}
  } else watchRooms(true);
});

const ROOM_STATE = { wait: '자리 있음', full: '가득 참', playing: '게임 중' };
function roomRow(r) {
  if (r.priv) return { off: true, spec: false, label: ROOM_STATE[r.state] || '' };
  if (r.state === 'wait') return { off: false, spec: false, label: ROOM_STATE.wait };
  if (r.spec !== false) {
    if (r.state === 'playing') return { off: false, spec: true, label: r.n < r.max ? '게임 중 · 관전' : '관전만' };
    if (r.state === 'full') return { off: false, spec: true, label: '가득 참 · 관전' };
  }
  return { off: true, spec: false, label: ROOM_STATE[r.state] || '' };
}
function renderRooms(list) {
  const open = list.filter(r => r.state === 'wait' && !r.priv).length;
  $('#roomCount').textContent = list.length ? `${open}곳` : '';
  $('#roomEmpty').hidden = list.length > 0;
  $('#roomList').innerHTML = list.map(r => {
    const v = roomRow(r);
    return `<li><button class="room-row" ${r.priv ? '' : `data-code="${esc(r.code)}"`}${v.off ? ' disabled' : ''}>
      <span class="rr-av"><img src="${faceImg(r.face || 'roach')}" alt=""></span>
      <span class="rr-main"><span class="rr-host">${esc(r.host || '이름 없음')}의 테이블</span>
        <span class="rr-meta"><span class="edtag ${r.ed}">${r.ed === 'royal' ? '로얄' : '기본'}</span>${r.priv ? '비공개' : `<span class="rr-code">${esc(r.code)}</span>`} · ${r.n}/${r.max}명${r.watching ? ` · 관전 ${r.watching}` : ''}</span></span>
      <span class="rr-st ${v.spec ? 'spec' : esc(r.state)}">${v.label}</span>
    </button></li>`;
  }).join('');
}
$('#roomList').addEventListener('click', e => {
  const b = e.target.closest('.room-row');
  if (!b || b.disabled || !b.dataset.code) return;
  $('#gCode').value = b.dataset.code;
  doJoin();
});
$('#gCode').onkeydown = e => { if (e.key === 'Enter') doJoin(); };
$('#gName').onkeydown = e => { if (e.key === 'Enter') $('#bCreate').click(); };

$('#bCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?r=${S.code}`;
  try { await navigator.clipboard.writeText(url); toast('초대 링크를 복사했어요'); }
  catch (_) { toast(url); }
};

$$('#edPick button').forEach(b => { b.onclick = () => { send({ t: 'cfg', edition: b.dataset.ed }); sfx.pop(); }; });
$('#tPriv').onclick = () => send({ t: 'cfg', priv: S.cfg.priv !== true });
$('#tSpec').onclick = () => send({ t: 'cfg', spec: S.cfg.spec === false });
$$('#segTime button').forEach(b => { b.onclick = () => send({ t: 'cfg', turnLimit: Number(b.dataset.ms) }); });
$('#bBot').onclick = () => send({ t: 'addBot' });
$('#bStart').onclick = () => { send({ t: 'start' }); ac(); };
$('#bAgain').onclick = () => send({ t: 'again' });

const leave = () => {
  const code = store.getItem('code'), token = store.getItem('token');
  store.removeItem('code'); store.removeItem('token');
  specCtx = null; specId = null; specRejoin = false;
  resting = false; wokeUp = false;
  $('#toast').classList.remove('on');
  if (ws && ws.readyState === 1) send({ t: 'leave' });
  else if (code && token) {
    leaving = true;
    connect(() => { send({ t: 'resume', code, token }); send({ t: 'leave' }); });
  }
  history.replaceState(null, '', location.pathname);
  S = null;
  show('title');
};
$('#bLeave1').onclick = leave;
$('#bLeave2').onclick = () => { if (isSpec() || confirm('정말 나갈까요? 내 자리는 봇이 이어받아요.')) leave(); };
$('#bLeave3').onclick = leave;

/* 도움말 */
$('#kindsStrip').innerHTML = ALL_KINDS.map(k => `<figure><img src="${faceImg(k)}" alt=""><figcaption>${NAMES[k]}</figcaption></figure>`).join('');
const openHelp = () => $('#help').classList.remove('hidden');
$$('[data-help]').forEach(b => b.onclick = openHelp);
$('#bHelpX').onclick = () => $('#help').classList.add('hidden');
$('#help').onclick = e => { if (e.target.id === 'help') $('#help').classList.add('hidden'); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { $('#help').classList.add('hidden'); $('#hist').hidden = true; if (!$('#chat').hidden) chatOpen(false); }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '?') openHelp();
});
$$('#helpTabs button').forEach(b => {
  b.onclick = () => {
    $$('#helpTabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tabpage').forEach(p => p.classList.toggle('on', p.dataset.page === b.dataset.tab));
  };
});

/* ─────────────────────────── 시작 ─────────────────────────── */

$('#gName').value = ls.get('name') || '';
const invited = new URLSearchParams(location.search).get('r');
if (invited) $('#gCode').value = invited.toUpperCase().slice(0, 4);

if (store.getItem('code') && store.getItem('token')) {
  connect(() => send({ t: 'resume', code: store.getItem('code'), token: store.getItem('token') }));
} else if (invited) {
  show('setup');
} else {
  show('title');
}
