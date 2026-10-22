"""제미나이 그림 오른쪽 아래의 반짝이 표시를 걷어낸다.

    python tools/dewatermark.py raw/back.png [raw/front.png ...]      # 제자리에 덮어쓴다

반짝이는 흰색을 반투명하게 얹은 것이라  P = (1-a)·F + a·255  로 되돌릴 수 있다.
a(모양)는 마젠타 바탕 위에 반짝이만 오롯이 앉아 있는 raw/creatures.png 에서 뽑아 둔다
(마젠타의 초록 채널은 거의 0 이라 초록이 올라간 만큼이 곧 a 다).
그림마다 위치와 크기가 조금씩 달라서, 밝기가 '흰색 쪽으로 들뜬 정도'와 가장 잘 맞는 자리·배율을 찾는다.
"""
import sys
import numpy as np
from PIL import Image

def template():
    im = np.asarray(Image.open('raw/creatures.png').convert('RGB')).astype(np.float32)
    H, W, _ = im.shape
    crop = im[H - 175:H - 65, W - 175:W - 65]       # 반짝이 둘레만 (스티커 테두리 크림색이 섞이지 않게)
    g = crop[..., 1]
    mag = (crop[..., 0] > 200) & (crop[..., 2] > 200) & (g < 140)
    a = np.where(mag, np.clip((g - 6) / 249, 0, 1), 0)
    # 별 덩어리만 남긴다 — 다리 가장자리 선이 섞여 들어온다
    from scipy import ndimage
    lab, n = ndimage.label(a > 0.15)
    big = np.argmax(ndimage.sum(np.ones_like(a), lab, range(1, n + 1))) + 1
    keep = ndimage.binary_dilation(lab == big, iterations=2)
    a = np.where(keep, a, 0)
    ys, xs = np.nonzero(a > 0.03)
    a = a[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
    # 별은 위아래·좌우가 같다. 한쪽 끝이 다리에 가려 잘렸으면 반대쪽으로 채운다
    h, w = a.shape
    a = np.maximum(a, a[::-1, :]); a = np.maximum(a, a[:, ::-1])
    return a

T = template()

def lift(img):
    """흰색 쪽으로 들뜬 정도 — 주변(블러)보다 밝은 만큼"""
    from PIL import ImageFilter
    L = np.asarray(img.convert('L')).astype(np.float32)
    B = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(14))).astype(np.float32)
    return L - B

def fix(path):
    """반짝이 자리는 그림 크기와 상관없이 오른쪽 아래 모서리에서 같은 거리(146px)·같은 크기다
    (펠트 배경에서 맞춰 본 값, 맞음 0.96). 자리를 찾지 않고 세기만 맞춘다."""
    img = Image.open(path).convert('RGB')
    P = np.asarray(img).astype(np.float32)
    H, W, _ = P.shape
    th, tw = T.shape
    y, x = H - 146, W - 146
    region = P[y:y + th, x:x + tw].copy()
    a = T[..., None]
    best_k, best_err = 1.0, None
    for k in np.linspace(0.6, 1.4, 17):
        ak = np.clip(a * k, 0, 0.95)
        F = np.clip((region - ak * 255) / (1 - ak), 0, 255)
        Fi = Image.fromarray(F.astype(np.uint8))
        e = np.abs(lift(Fi))[4:-4, 4:-4].mean()
        if best_err is None or e < best_err: best_k, best_err = k, e
    ak = np.clip(a * best_k, 0, 0.95)
    P[y:y + th, x:x + tw] = np.clip((region - ak * 255) / (1 - ak), 0, 255)
    # 별 가장자리(반투명 테두리)에 남는 점은 둘레의 중간값으로 덮는다
    from scipy import ndimage
    edge = ndimage.binary_dilation((T > 0.01) & (T < 0.4), iterations=2) & ~ndimage.binary_erosion(T > 0.4, iterations=2)
    sub = P[y:y + th, x:x + tw]
    med = np.stack([ndimage.median_filter(sub[..., c], size=7) for c in range(3)], -1)
    sub[edge] = med[edge]
    Image.fromarray(P.astype(np.uint8)).save(path)
    print(path, f'세기 {best_k:.2f}')

for p in sys.argv[1:]:
    fix(p)
