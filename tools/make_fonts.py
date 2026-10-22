"""한글 글꼴을 자주 쓰는 글자(KS X 1001 완성형 2350자 + 영문·숫자·기호)만 남겨 woff2 로 줄인다.
    python tools/make_fonts.py
원본 TTF(raw/fonts, Google Fonts OFL)는 커서 저장소에 올리지 않는다.
"""
from fontTools import subset
chars = set(chr(c) for c in range(0x20, 0x7f))
for hi in range(0xB0, 0xC9):
    for lo in range(0xA1, 0xFF):
        try: chars.add(bytes([hi, lo]).decode('euc-kr'))
        except UnicodeDecodeError: pass
chars |= set('ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅋㅎ…·—–‘’“”「」『』×÷→←↑↓↻↺♠♥♦♣★☆●○◆◇■□▶◀✓✕♪~!?％%')
text = ''.join(sorted(chars))
for src, out in [('GowunBatang-Bold', 'gowun-b'), ('GowunBatang-Regular', 'gowun-r'), ('Jua-Regular', 'jua')]:
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['*']
    f = subset.load_font(f'raw/fonts/{src}.ttf', opts)
    s = subset.Subsetter(opts); s.populate(text=text); s.subset(f)
    subset.save_font(f, f'public/fonts/{out}.woff2', opts)
    import os; print(out, os.path.getsize(f'public/fonts/{out}.woff2') // 1024, 'KB')
