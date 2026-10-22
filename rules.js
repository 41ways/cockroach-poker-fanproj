'use strict';
/**
 * 바퀴벌레 포커 — 규칙만 (순수 함수). 서버와 테스트가 같이 쓴다.
 *
 * 두 가지 판이 있다.
 *  기본판(base)  생물 8종 × 8장 = 64장을 모두 나눠 준다.
 *  로얄판(royal) 생물 7종(거미 없음) × 8장 + 왕 카드 7장(종마다 1장) + 특수 카드 2장(신하 · 검은 카드) = 65장.
 *               7장(2인이면 16장)을 벌칙 더미로 덮어 두고 맨 윗장만 펼친다. 나머지를 나눠 준다.
 *
 * 카드 한 장 = { id, k, r? }
 *  k  생물(roach …) 또는 특수 카드('subject' 신하 · 'black' 검은 카드)
 *  r  왕 카드면 true — 그 생물로도, "왕" 으로도 맞다
 *
 * 2인은 두 판 모두 넘기기가 없고 같은 생물 5장이면 진다. 기본판 2인은 카드 10장을 보지 않고 빼고 나눈다.
 *
 * 앞에 같은 생물이 4장(2인은 5장) 쌓이거나, 내밀 차례인데 손에 카드가 없으면 진다. 왕 카드도 그 생물로 센다.
 */

const KINDS = ['roach', 'rat', 'stink', 'scorp', 'toad', 'bat', 'fly', 'spider'];
const ROYAL_KINDS = KINDS.filter(k => k !== 'spider');
const NAMES = {
  roach: '바퀴벌레', rat: '쥐', stink: '노린재', scorp: '전갈',
  toad: '두꺼비', bat: '박쥐', fly: '파리', spider: '거미',
  royal: '왕', subject: '신하', black: '검은 카드',
};
const PER_KIND = 8;
const EDITIONS = ['base', 'royal'];

const kindsOf = ed => (ed === 'royal' ? ROYAL_KINDS : KINDS);
/** 말할 수 있는 것 — 로얄판에는 "왕" 이 하나 더 있다 */
const claimsOf = ed => (ed === 'royal' ? ROYAL_KINDS.concat('royal') : KINDS.slice());
const isSpecial = c => c.k === 'subject' || c.k === 'black';
const loseAt = (ed, n) => (n === 2 ? 5 : 4);
const penaltySize = (ed, n) => (ed === 'royal' ? (n === 2 ? 16 : 7) : 0);
/** 기본판 2인 — 나누기 전에 아무도 보지 않고 빼 두는 장 수 */
const removedSize = (ed, n) => (ed === 'base' && n === 2 ? 10 : 0);
/** 넘기기 — 2인은 두 판 모두 금지 (원작 규칙서의 2인 규칙) */
const canPass = (ed, n) => n > 2;

function makeDeck(ed) {
  const deck = [];
  let id = 1;
  for (const k of kindsOf(ed)) for (let i = 0; i < PER_KIND; i++) deck.push({ id: id++, k });
  if (ed === 'royal') {
    for (const k of ROYAL_KINDS) deck.push({ id: id++, k, r: true });
    deck.push({ id: id++, k: 'subject' }, { id: id++, k: 'black' });
  }
  return deck;
}

/**
 * 섞인 덱을 n 명 몫과 벌칙 더미로 나눈다.
 * 로얄판: 벌칙 더미를 먼저 떼고 나머지를 똑같이. 남는 장은 첫 사람이 한 장 더 갖고 나머지는 벌칙 더미로.
 * 기본판: 남는 장은 앞자리부터 한 장씩 더.
 */
function deal(deck, n, ed) {
  const d = deck.slice();
  const removed = d.splice(0, removedSize(ed, n));   // 기본판 2인 — 상자에 도로 넣는다
  const penalty = d.splice(0, penaltySize(ed, n));
  const base = Math.floor(d.length / n);
  let extra = d.length - base * n;
  const hands = [];
  for (let i = 0; i < n; i++) {
    let take = base;
    if (ed === 'royal') { if (i === 0 && extra > 0) { take++; extra--; } }
    else if (extra > 0) { take++; extra--; }
    hands.push(d.splice(0, take));
  }
  penalty.push(...d);                 // 로얄판에서 남은 장
  return { hands, penalty, removed };
}

/**
 * 말은 두 가지 꼴이다 — "이건 두꺼비야"(toad) 와 "이건 두꺼비가 아니야"(!toad).
 * 아니라는 말은 그 생물이라는 말을 뒤집은 것이다. 검은 카드만은 어떤 말이든 틀린다.
 */
const NOT = '!';
const isNeg = claim => typeof claim === 'string' && claim[0] === NOT;
const baseOf = claim => (isNeg(claim) ? claim.slice(1) : claim);
const isClaim = (ed, claim) => claimsOf(ed).includes(baseOf(claim));

/** 카드가 이 말에 맞나 */
function truthOf(card, claim) {
  if (isNeg(claim)) return card.k !== 'black' && !truthOf(card, baseOf(claim));
  return truthPlain(card, claim);
}
function truthPlain(card, claim) {
  if (card.k === 'black') return false;                 // 검은 카드 — 무엇이라 해도 틀린다
  if (card.k === 'subject') return claim !== 'royal';   // 신하 — 아무 생물이나 되지만 왕은 아니다
  if (card.r) return claim === card.k || claim === 'royal';
  return claim === card.k;
}

/**
 * 받은 사람이 "진짜다/거짓말" 을 외쳤을 때 누가 카드를 가져가나.
 *  맞히면 넘긴 사람이, 틀리면 받은 사람이 가져간다.
 */
function judge(card, claim, sayTrue) {
  const truth = truthOf(card, claim);
  const right = sayTrue === truth;
  return { truth, right, taker: right ? 'from' : 'to' };
}

/** 특수 카드를 떠안았을 때 앞에 내려놓을 수 있는 "맞는 카드" — 마지막에 들은 말과 맞는 생물(왕 포함) */
const tributeMatch = (card, claim) => !isSpecial(card) && truthOf(card, claim);

const emptyRow = ed => Object.fromEntries(kindsOf(ed).map(k => [k, 0]));
const lostByRow = (row, at) => Object.values(row).some(v => v >= at);

module.exports = {
  KINDS, ROYAL_KINDS, NAMES, PER_KIND, EDITIONS,
  kindsOf, claimsOf, isSpecial, NOT, isNeg, baseOf, isClaim, loseAt, penaltySize, removedSize, canPass,
  makeDeck, deal, truthOf, judge, tributeMatch, emptyRow, lostByRow,
};
