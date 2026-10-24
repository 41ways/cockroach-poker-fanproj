#!/bin/sh
# 방금 받은 제미나이 그림 하나를 raw/<이름>.png 로 옮긴다 — 다운로드 폴더의 다른 파일은 건드리지 않는다
# 윈도우(Git Bash) · 맥 둘 다: GNU 전용 find -printf · cygpath 를 쓰지 않는다
for i in 1 2 3 4 5 6 7 8 9 10; do
  f=$(find ~/Downloads -maxdepth 1 -name 'Gemini_Generated_Image_*' -mmin -2 -exec ls -t {} + 2>/dev/null | head -1)
  [ -n "$f" ] && break; sleep 2
done
[ -z "$f" ] && { echo none; exit 1; }
cd "$(dirname "$0")/.." || exit 1
mkdir -p raw
mv "$f" "raw/$1.png" || exit 1
# 윈도우는 python, 맥은 python3 — Pillow 가 깔린 쪽을 쓴다
for PY in python3 python; do "$PY" -c "import PIL" 2>/dev/null && break; done
"$PY" -c "from PIL import Image; im = Image.open('raw/$1.png'); print('$1', im.size)"
