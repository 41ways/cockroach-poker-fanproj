#!/bin/sh
# 방금 받은 제미나이 그림 하나를 raw/<이름>.png 로 옮긴다 — 다운로드 폴더의 다른 파일은 건드리지 않는다
for i in 1 2 3 4 5 6 7 8 9 10; do
  f=$(find ~/Downloads -maxdepth 1 -name 'Gemini_Generated_Image_*' -mmin -2 -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
  [ -n "$f" ] && break; sleep 2
done
[ -z "$f" ] && { echo none; exit 1; }
mv "$f" "$(dirname "$0")/../raw/$1.png" && python -c "from PIL import Image;im=Image.open(r'$(cygpath -w "$(dirname "$0")/../raw/$1.png")');print('$1',im.size)"
