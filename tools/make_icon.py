"""Draws the app icon (dev tool, needs Pillow): ui/icon.png for the window, app/icon.ico for the exe.
Run: python -m tools.make_icon"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BG, CARD, RED, WHITE = (15, 17, 21), (24, 27, 34), (229, 72, 77), (232, 234, 240)


def draw(size=1024):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size / 1024
    d.rounded_rectangle([24 * s, 24 * s, 1000 * s, 1000 * s], radius=220 * s, fill=CARD, outline=(42, 47, 58), width=int(14 * s))
    c, r = 512 * s, 300 * s
    # three worlds joined in a ring: the multiworld
    pts = [(c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))) for a in (-90, 30, 150)]
    for i in range(3):
        d.line([pts[i], pts[(i + 1) % 3]], fill=(70, 76, 90), width=int(26 * s))
    for x, y in pts:
        d.ellipse([x - 92 * s, y - 92 * s, x + 92 * s, y + 92 * s], fill=BG, outline=RED, width=int(30 * s))
    # play button in the middle
    t = 120 * s
    d.polygon([(c - t * 0.75, c - t), (c - t * 0.75, c + t), (c + t * 1.05, c)], fill=WHITE)
    return im


def main():
    big = draw()
    big.resize((256, 256), Image.LANCZOS).save(ROOT / "ui" / "icon.png")
    big.resize((256, 256), Image.LANCZOS).save(ROOT / "app" / "icon.ico",
                                               sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("ui/icon.png, app/icon.ico")


if __name__ == "__main__":
    main()
