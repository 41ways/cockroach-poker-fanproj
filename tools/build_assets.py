"""raw/ 의 제미나이 원본(워터마크 걷어낸 것)과 잘라 낸 PNG 로 화면에 쓸 그림을 만든다.

    python tools/build_assets.py

- 카드 앞면 8장: 앞면 틀(front) 한가운데에 생물을 얹어 한 장으로 굽는다. 이름은 화면에서 글자로 얹는다.
- 뒷면 · 펠트 · 타이틀 · 칩 · 결과 그림은 크기만 맞춰 webp 로.
"""
from PIL import Image
import os
OUT = 'public/img'
CW, CH = 480, 716
names = ['roach', 'rat', 'stink', 'scorp', 'toad', 'bat', 'fly', 'spider']

def save(im, name, q=86):
    im.save(f'{OUT}/{name}.webp', 'WEBP', quality=q, method=6)
    print(name, im.size, os.path.getsize(f'{OUT}/{name}.webp') // 1024, 'KB')

front = Image.open('raw/front.png').convert('RGBA').resize((CW, CH), Image.LANCZOS)
back = Image.open('raw/back.png').convert('RGB').resize((CW, CH), Image.LANCZOS)
save(back, 'back')
save(front.convert('RGB'), 'front')
for n in names:
    c = Image.open(f'{OUT}/c_{n}.png').convert('RGBA')
    c = c.crop(c.getbbox())
    box_w, box_h = int(CW * 0.70), int(CH * 0.58)      # 틀 안쪽, 아래 이름 띠 위
    s = min(box_w / c.width, box_h / c.height)
    c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    card = front.copy()
    cx, cy = CW // 2, int(CH * 0.455)
    card.alpha_composite(c, (cx - c.width // 2, cy - c.height // 2))
    save(card.convert('RGB'), f'card_{n}')
    # 앉은 자리 얼굴(아바타)·작은 표시에 쓸 생물 낱장
    save(Image.open(f'{OUT}/c_{n}.png').resize((256, 256), Image.LANCZOS), f'c_{n}', 88)
    os.remove(f'{OUT}/c_{n}.png')

# 로얄판 — 왕 카드 7장(화려한 틀, 위 왕관 아래로 생물), 신하(크림 틀), 검은 카드, 로얄 뒷면
rframe = Image.open('raw/rframe.png').convert('RGBA').resize((CW, CH), Image.LANCZOS)
save(Image.open('raw/rback.png').convert('RGB').resize((CW, CH), Image.LANCZOS), 'rback')
# 검은 카드는 원작처럼 가운데가 비어 있다 — black.png 의 나방 무늬를 걷어 낸 black_blank.png
save(Image.open('raw/black_blank.png').convert('RGB').resize((CW, CH), Image.LANCZOS), 'card_black')
for n in names[:7] + ['subject']:
    c = Image.open(f'{OUT}/k_{n}.png').convert('RGBA')
    c = c.crop(c.getbbox())
    royal = n != 'subject'
    box_w, box_h = int(CW * 0.70), int(CH * (0.50 if royal else 0.58))
    s = min(box_w / c.width, box_h / c.height)
    c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
    card = (rframe if royal else front).copy()
    cx, cy = CW // 2, int(CH * (0.52 if royal else 0.455))
    card.alpha_composite(c, (cx - c.width // 2, cy - c.height // 2))
    save(card.convert('RGB'), f'card_{"k_" + n if royal else n}')
    save(Image.open(f'{OUT}/k_{n}.png').resize((256, 256), Image.LANCZOS), f'k_{n}', 88)
    os.remove(f'{OUT}/k_{n}.png')

tb = Image.open('raw/table.png').convert('RGB')
save(tb, 'table', 80)
t = Image.open(f'{OUT}/title.png'); t = t.crop(t.getbbox()); save(t.resize((t.width * 900 // t.width, t.height * 900 // t.width), Image.LANCZOS), 'title', 88); os.remove(f'{OUT}/title.png')
for n in ['ok', 'no', 'pass', 'peek']:
    save(Image.open(f'{OUT}/chip_{n}.png'), f'chip_{n}', 88); os.remove(f'{OUT}/chip_{n}.png')
for n in ['laugh', 'loser']:
    r = Image.open(f'{OUT}/r_{n}.png'); r = r.crop(r.getbbox()); r.thumbnail((520, 520), Image.LANCZOS); save(r, f'r_{n}', 88); os.remove(f'{OUT}/r_{n}.png')
