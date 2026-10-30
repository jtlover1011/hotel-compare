#!/usr/bin/env python3
"""生成 App 图标（全出血方形，iOS 会自己切圆角）"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "icons")
os.makedirs(OUT, exist_ok=True)

C1 = (10, 132, 255)    # 0A84FF
C2 = (94, 92, 230)     # 5E5CE6

FONT_CANDIDATES = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def gradient(size):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    # 对角渐变 0 -> 1
    t = (x + y) / (2.0 * (size - 1))
    t = t ** 0.95
    arr = np.zeros((size, size, 3), dtype=np.float32)
    for i in range(3):
        arr[:, :, i] = C1[i] + (C2[i] - C1[i]) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def draw_glyph(img, size):
    glyph = "¥"
    font = None
    for path in FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, int(size * 0.66))
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    box = d.textbbox((0, 0), glyph, font=font)
    w = box[2] - box[0]
    h = box[3] - box[1]
    pos = ((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.02)

    # 柔和投影
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((pos[0], pos[1] + size * 0.012), glyph, font=font, fill=(0, 0, 40, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.018))
    img.paste(Image.alpha_composite(img.convert("RGBA"), shadow).convert("RGB"), (0, 0))

    d = ImageDraw.Draw(img)
    d.text(pos, glyph, font=font, fill=(255, 255, 255, 255))
    return img


def build(size):
    img = gradient(size)
    draw_glyph(img, size)
    return img


base = build(1024)
for s in (180, 192, 512):
    base.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, "icon-%d.png" % s), optimize=True)
    print("wrote icon-%d.png" % s)

base.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "favicon.png"), optimize=True)
print("done")
