# make-icons.py —— 生成扩展图标（几何图形，无字体依赖）
# 用法：python scripts/make-icons.py
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "icons")
os.makedirs(OUT, exist_ok=True)

def draw_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = size // 16
    # 圆角深蓝底
    d.rounded_rectangle([m, m, size - m, size - m], radius=size // 5, fill=(31, 56, 100, 255))
    # 三条「文本行」
    lw = max(2, size // 12)
    x0, x1 = int(size * 0.22), int(size * 0.78)
    ys = [int(size * 0.32), int(size * 0.50), int(size * 0.68)]
    for i, y in enumerate(ys):
        right = x1 if i < 2 else int(size * 0.62)
        d.rounded_rectangle([x0, y - lw // 2, right, y + lw // 2], radius=lw // 2, fill=(255, 255, 255, 255))
    # 斜杠（去除/清扫符号）
    d.line([int(size * 0.24), int(size * 0.80), int(size * 0.80), int(size * 0.20)],
           fill=(255, 196, 61, 255), width=max(3, size // 10))
    return img

for s in (16, 32, 48, 128):
    draw_icon(s).save(os.path.join(OUT, f"icon{s}.png"))
    print("icon%d.png" % s)

print("done ->", os.path.abspath(OUT))
