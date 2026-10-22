"""마젠타 바탕 시트에서 그림 덩어리를 잘라 투명 PNG 로 만든다.

    python tools/cut_sheet.py raw/creatures.png public/img/c_ --names roach,rat,stink,scorp,toad,bat,fly,spider --size 512

- 바탕은 '빨강·파랑은 높고 초록은 낮은' 정도(min(R,B)-G)로 알아본다. 갈색·자주색 생물은 이 값이 낮아서 살아남는다.
- 반투명 가장자리는 마젠타가 섞인 만큼을 빼서(despill) 분홍 테두리가 남지 않게 한다.
- 덩어리를 크기순으로 고른 뒤 위→아래, 왼→오른 순서로 이름을 붙인다. 작은 티끌(제미나이 반짝이 표시 등)은 버린다.
"""
import argparse
import numpy as np
from PIL import Image
from collections import deque

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('prefix')
ap.add_argument('--names', required=True)
ap.add_argument('--size', type=int, default=512, help='정사각 캔버스 한 변')
ap.add_argument('--lo', type=float, default=70)
ap.add_argument('--hi', type=float, default=190)
ap.add_argument('--rows', type=int, default=0, help='줄 수(0 이면 자동)')
a = ap.parse_args()
names = a.names.split(',')

im = np.asarray(Image.open(a.src).convert('RGB')).astype(np.float32)
H, W, _ = im.shape
R, G, B = im[..., 0], im[..., 1], im[..., 2]
# 바탕색은 네 귀퉁이의 중간값
corners = np.concatenate([im[:8, :8].reshape(-1, 3), im[:8, -8:].reshape(-1, 3), im[-8:, :8].reshape(-1, 3)])
M = np.median(corners, axis=0)
m = np.minimum(R, B) - G
alpha = 1 - np.clip((m - a.lo) / (a.hi - a.lo), 0, 1)

# 덩어리 찾기 (alpha>0.5, 4-이웃) — 작은 그림이라 파이썬 BFS 로 충분
mask = alpha > 0.5
lab = np.zeros((H, W), np.int32)
blobs = []
cur = 0
for y in range(H):
    for x in range(W):
        if mask[y, x] and not lab[y, x]:
            cur += 1
            q = deque([(y, x)]); lab[y, x] = cur
            n = 0; y0 = y1 = y; x0 = x1 = x
            while q:
                cy, cx = q.popleft(); n += 1
                y0 = min(y0, cy); y1 = max(y1, cy); x0 = min(x0, cx); x1 = max(x1, cx)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur; q.append((ny, nx))
            blobs.append(dict(id=cur, n=n, box=(x0, y0, x1, y1)))

big = sorted(blobs, key=lambda b: -b['n'])
main = big[:len(names)]
small = big[len(names):]
# 큰 덩어리 옆에 붙은 조각(더듬이·다리 끝이 끊긴 것)은 겹치는 큰 덩어리에 합친다
def inside(b, o, pad=6):
    x0, y0, x1, y1 = b['box']; X0, Y0, X1, Y1 = o['box']
    return x0 >= X0 - pad and y0 >= Y0 - pad and x1 <= X1 + pad and y1 <= Y1 + pad
for s in small:
    if s['n'] < 40: continue
    for b in main:
        if inside(s, b, 30):
            b.setdefault('extra', []).append(s['id'])
            x0, y0, x1, y1 = b['box']; X0, Y0, X1, Y1 = s['box']
            b['box'] = (min(x0, X0), min(y0, Y0), max(x1, X1), max(y1, Y1))
            break

# 위→아래 줄로 묶고 줄 안에서 왼→오른
main.sort(key=lambda b: (b['box'][1] + b['box'][3]) / 2)
rows = a.rows or (2 if len(main) > 4 else 1)
per = int(np.ceil(len(main) / rows))
ordered = []
for r in range(rows):
    ordered += sorted(main[r * per:(r + 1) * per], key=lambda b: b['box'][0])

# 마젠타 빼기: P = a*F + (1-a)*M  →  F = (P - (1-a)M)/a
af = alpha[..., None]
F = np.where(af > 0.02, (im - (1 - af) * M) / np.maximum(af, 0.02), im)
F = np.clip(F, 0, 255)

for name, b in zip(names, ordered):
    ids = [b['id']] + b.get('extra', [])
    keep = np.isin(lab, ids)
    # 덩어리 둘레의 반투명 띠도 살린다(한 칸 넓혀서)
    k = keep.copy()
    for _ in range(3):
        k2 = k.copy()
        k2[1:] |= k[:-1]; k2[:-1] |= k[1:]; k2[:, 1:] |= k[:, :-1]; k2[:, :-1] |= k[:, 1:]
        k = k2
    x0, y0, x1, y1 = b['box']
    x0 = max(0, x0 - 4); y0 = max(0, y0 - 4); x1 = min(W - 1, x1 + 4); y1 = min(H - 1, y1 + 4)
    A = np.where(k, alpha, 0)[y0:y1 + 1, x0:x1 + 1]
    rgba = np.dstack([F[y0:y1 + 1, x0:x1 + 1], A * 255]).astype(np.uint8)
    tile = Image.fromarray(rgba, 'RGBA')
    S = a.size
    sc = min((S * 0.92) / tile.width, (S * 0.92) / tile.height)
    tile = tile.resize((max(1, round(tile.width * sc)), max(1, round(tile.height * sc))), Image.LANCZOS)
    can = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    can.paste(tile, ((S - tile.width) // 2, (S - tile.height) // 2), tile)
    out = f'{a.prefix}{name}.png'
    can.save(out, optimize=True)
    print(out, b['box'], b['n'], 'scale', round(sc, 2))
print('티끌', [s['n'] for s in small[:6]])
