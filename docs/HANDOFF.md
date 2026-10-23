# 바퀴벌레 포커 — 인계 문서

> 다음 세션은 이 문서만 읽고 바로 이어서 일할 수 있게 쓴다. 최신 상태: 2026-10-23 아침.
> **읽었다고 바로 고치기 시작하지 말 것** — 사용자가 시키는 일만 한다.

## 주소

| | |
|---|---|
| 플레이 | https://cockroach.41ways.workers.dev |
| GitHub | https://github.com/41ways/cockroach-poker-fanproj (공개, main) |
| 폴더 | `C:\Users\정한결\cockroach-poker-fanproj` |
| 허브 | https://41ways.github.io/norara/ — 카드 등록됨, 추천 6번(`data-rec="6"`) |
| 로컬 프리뷰 | `~/.claude/launch.json` 의 `cockroach` (node server.js, 8795 — 막혀 있으면 다른 포트로 뜬다) |

**시작 전 `git pull`.** 사용자가 여러 세션·기기에서 만진다.

## 무엇인가

보드게임 『바퀴벌레 포커』 온라인판. 2~6인, 봇으로 빈자리를 채운다. 방장이 대기실에서 **기본판 / 로얄판**을 고른다.

- **기본판**: 생물 8종(바퀴벌레·쥐·노린재·전갈·두꺼비·박쥐·파리·거미) × 8장 = 64장
- **로얄판**: 거미 없는 7종 × 8 + 왕 카드 7장 + 신하 + 검은 카드 = 65장, 벌칙 더미 7장(2인 16장)
- **2인**(두 판 모두, 원작 규칙서): 넘기기 없음, 같은 생물 **5장**이면 패배. 기본판 2인은 카드 10장을 보지 않고 빼고 시작
- **덧붙인 규칙**(원작에 없음, 사용자 요청): “이건 ○○가 아니야” 말하기(claim 앞에 `!`, 예 `!toad`). 검은 카드는 이 말에도 틀린다
- **정한 규칙**(원작 규칙서에 없는 경우): 벌칙 더미에서 신하·검은 카드가 나오면 떠안았을 때와 똑같이 값을 치른다

원작 대조 근거와 결과는 `docs/OVERNIGHT.md` 1번. 로얄 상자 표기 66장은 설명 카드 포함, 실제는 65장.

## 짜임 (로보77 · 할리갈리와 같은 허브 표준)

```
rules.js        규칙만 (순수 함수) — 덱, 나누기(deal), 말 판정(truthOf/judge), 2인 규칙, 값 치르기 맞는 카드
game.js         권위 서버 — 방 · 손패 · 오가는 카드(chain) · 판정(reveal) · 값 치르기(tribute) · 벌칙 더미 · 타이머 · 봇 ·
                열린 방 목록 · 관전 · 채팅 · 표정 · 재접속. 통신 방식은 모른다(send/close/readyState 만)
worker.js       Cloudflare Worker + Durable Object 하나(main) — 방은 전부 그 메모리에. 20분 무조작 연결 닫기, 빈 방 청소
server.js       Node 로컬 서버 — 같은 game.js 를 ws 로 (개발 · 테스트)
public/         index.html · style.css · app.js · img/(제미나이 그림 webp) · fonts/(고운바탕 · 주아 잘라 넣음) · _headers(캐시)
tools/          그림 가공 (아래)
test/           rules.js(예외 21개) · sim.js · soak.js(대량) · e2e.js(소켓 둘) · prod.js(배포본 한 판)
docs/           OVERNIGHT.md(밤샘 기록) · HANDOFF.md(이 문서)
raw/            제미나이 원본 · 글꼴 TTF — git 제외(.gitignore). 이 PC에만 있다
```

판 흐름(서버 상태): `starter` 가 `give` → `chain{from,to,claim,seen,path,step}` → 받은 사람 `call`(진짜/거짓) 또는 `peek`→`pass` →
`reveal`(3.4초) → 가져간 사람 앞에 `place`(왕이면 벌칙 더미 연쇄) / 특수 카드면 `tribute` → `afterPlace`(4장·빈손 패배 검사) → 다음 `starter`.
오가는 카드 정체는 `chain.seen` 에 든 사람에게만 내려간다(`stateFor`).

## 시험

```bash
npm test                              # rules.js(21) · sim.js · soak.js 400판
GAMES=3000 PAR=60 node test/soak.js   # 대량 — 실패 · 멈춘 판 · 정보 누출 · 무작위 대비 봇 실력
node test/prod.js royal 4             # 배포본에서 실제 속도로 한 판(봇 + 무작위 자리)
ROACH_FAST=1 PORT=8799 node server.js & PORT=8799 node test/e2e.js
```

**화면 확인 요령**
- 브라우저 확인은 **늘 음소거**(사용자 규칙, 메모리 feedback-mute-when-testing): `localStorage.setItem('roach.mute','1')` + 음소거 스니펫
- 내장 브라우저 창이 숨겨져 있으면 애니메이션 · 타이머가 멈춰 스크린샷이 반투명하거나 늦다 → `?qa=1` 로 열고
  `window.__feed(state)` 로 상태를 손으로 넣어 멈춰 놓고 본다(넣은 뒤에는 서버 메시지를 무시함). 애니메이션 끄는 style 을 주입하고 찍는다
- 크롬(Claude in Chrome) 탭으로 배포본을 열면 실제 속도로 볼 수 있다. 자기 탭 그룹만 쓸 것

## 그림

모두 제미나이(사용자 크롬, 채팅 https://gemini.google.com/app/bf3f01c60cefa704 — 스타일 이어 쓰기)로 만들었다. 한도는 다른 게임 세션과 같은 계정이라 공유.

1. 마젠타(#FF00FF) 바탕 시트로 요청 → 다운로드 → `tools/grab.sh <이름>` 이 `~/Downloads` 최신 `Gemini_Generated_Image_*` 를 `raw/<이름>.png` 로 옮긴다(**받자마자 내 그림인지 눈으로 확인** — 다운로드 폴더를 다른 세션도 씀)
2. `python tools/dewatermark.py raw/x.png` — 오른쪽 아래 반짝이 표시 걷기(모서리에서 146px 고정)
3. `python tools/cut_sheet.py raw/creatures.png public/img/c_ --names roach,rat,... --size 512` — 덩어리 잘라 투명 PNG
4. `python tools/build_assets.py` — 카드 앞면 합성(틀 + 생물), webp 굽기. 검은 카드는 `raw/black_blank.png`(나방 무늬 걷은 것) → `card_blank.webp`
5. 글꼴: `python tools/make_fonts.py` (KS X 1001 2350자로 잘라 woff2)

그림을 바꿀 때 **파일 이름을 바꾸면** 브라우저 하루 캐시(`_headers`)를 피한다(검은 카드를 그렇게 바꿨다).

## 배포

```bash
npx wrangler deploy        # PowerShell 이면 npx.cmd
git push
```

- Cloudflare Workers 무료 플랜 · 결제 수단 없음 → 한도를 넘어도 요금 없이 그날 요청만 거절. 사용자는 **서버 비용 0원**을 원한다
- `wrangler login` 이 만료되면 사용자가 브라우저에서 승인해야 한다(2026-10-22 갱신)
- **배포하면 진행 중인 판이 모두 끊긴다**(방이 DO 메모리에만 있음). 사용자가 플레이할 시간대엔 배포하지 말 것
- 커밋 메시지: 한국어 한 줄 요약 + 필요하면 본문. **`Co-Authored-By: Claude …` 줄은 모든 저장소에서 금지**(2026-10-23 이 저장소 이력에서도 지우고 force push 함)

## 밤샘(10/22~23) 결과 요약

- 고침: 기본판 2인 규칙, 검은 카드 빈 카드, 벌칙 더미 특수 카드 처리, 끊긴 사람 대신 두기 한 번에, 끊긴 판 10분 유지, “(봇)” 이름 문제,
  봇이 위험한 생물을 따짐, 6인 · 태블릿 · 작은 폰 화면, 대기실 인원별 규칙 한 줄, 모바일 채팅 단추 위치
- 시험: 규칙 21/21(10번 반복), 시뮬레이션 1만 1천 판 넘게 실패 0, 배포본 끝까지 4판 오류 0
- 자세한 것은 `docs/OVERNIGHT.md`

## 시작 화면 (2026-10-23)

시안 5개(`design/시안*.png`, 시안 페이지는 `public/mock/` — git 제외) 중 사용자가 고른 조합: **시안 1 그림 + 리본 제목, 시안 2 칩 단추**. 바탕은 시안 5(와인/남색 가르기)로 한 번 바꿨다가 사용자 요청으로 초록 펠트로 되돌림.
칩은 판 왼쪽 끝에 걸쳐 판 모서리가 칩 뒤로 숨게 둔다(`.chipbtn img`). 사용자 규칙: 알약(양끝 둥근) 모양 금지.
방 고르기 · 대기실 · 게임 화면은 아직 알약 단추 그대로다. 이 게임은 초록 펠트를 사용자가 원한다.

## 남은 흠 · 다음에 할 만한 것

- 아주 작은 폰(높이 667 근처)은 내 차례에 손패를 보려면 아래로 스크롤해야 한다
- 카드가 날아가는 연출(`flyImg`)은 숨은 창에선 확인이 어려워 실제 크롬에서만 눈으로 봤다
- 봇은 무작위보다 낫지만 사람 고수 수준은 아니다(무작위 자리 패배율이 기대값보다 0.05~0.17 높은 정도)
- 서버 재시작(배포) 때 판이 사라지는 문제 — 고치려면 DO 저장소에 판을 적어야 하는데 무료 한도 · 복잡도와 맞바꿈이라 손대지 않음
- 아직 사용자 피드백 전. 사용자가 직접 해 본 뒤 말하는 것을 우선한다

## 관련 메모리

`~/.claude/projects/C--Users----/memory/` — `cockroach-poker-project.md`, `norara-game-hub.md`, `gemini-art-pipeline.md`, `feedback-mute-when-testing.md`, `feedback-follow-references.md`
