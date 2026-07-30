#!/usr/bin/env python3
"""Render what the draft screen's card-art windows will actually show.

The draft cards display TCGdex card *scans*, cropped down to just the
illustration by `.card-art` in app.css. There is no way to check that crop
from the test suite: the Playwright baseline shoots the whole page at a 1.5%
diff tolerance, and six small art windows are well under that. So this
renders every card in the art map through the crop and tiles them into a
contact sheet to look at.

    pip install pillow          # deliberately NOT a package.json dependency;
    python3 scripts/preview-card-crops.py     # this is a dev tool, not a build step

Scans are cached under .cache/card-scans/ (gitignored) so re-running after a
tuning change costs nothing.

IMPORTANT: this inverts the real CSS rather than doing an idealised crop.
`object-fit: cover` trims whichever axis overflows, and TCGdex scans come in
at least four different sizes, so an idealised fractional crop would hide
exactly the source-aspect drift the rectangles are chosen to avoid. If you
change the maths here, change it to match app.css, not to look nicer.
"""

import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("needs pillow: pip install pillow")

LANCZOS = getattr(Image, "Resampling", Image).LANCZOS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "card-scans")
OUT = os.path.join(ROOT, ".cache", "card-crops")
ART_MAP = os.path.join(ROOT, "src", "data", "tcgArtMap.json")
APP_CSS = os.path.join(ROOT, "src", "app", "app.css")
TCG_ART = os.path.join(ROOT, "src", "data", "tcgArt.ts")

# The window's own aspect (`.card-art-window { aspect-ratio }`), rendered at
# 2x so the sheet is legible.
WIN_W, WIN_H = 296, 188


def parse_rects():
    """The three era rectangles, read out of app.css so this can't drift."""
    css = open(APP_CSS, encoding="utf8").read()
    rects = {}
    for cls, era in (("card-art", None), ("card-art.era-mid", "era-mid"),
                     ("card-art.era-vintage", "era-vintage")):
        block = re.search(r"\.%s\s*\{(.*?)\}" % re.escape(cls), css, re.S)
        if not block:
            sys.exit(f"no .{cls} rule in app.css")
        vals = dict(re.findall(r"--art-([xywh]):\s*([0-9.]+)", block.group(1)))
        if len(vals) != 4:
            sys.exit(f".{cls} does not set all four --art-* values")
        rects[era] = {k: float(v) for k, v in vals.items()}
    return rects


def parse_overrides():
    """ART_RECT_OVERRIDES from tcgArt.ts — species that need their own rect."""
    ts = open(TCG_ART, encoding="utf8").read()
    block = re.search(r"ART_RECT_OVERRIDES[^=]*=\s*\{(.*?)\n\};", ts, re.S)
    out = {}
    if not block:
        return out
    for m in re.finditer(
        r"'?([A-Za-z0-9-]+)'?\s*:\s*\{x:\s*([\d.]+),\s*y:\s*([\d.]+),"
        r"\s*w:\s*([\d.]+),\s*h:\s*([\d.]+)\}",
        block.group(1),
    ):
        name, x, y, w, h = m.groups()
        out[name] = {"x": float(x), "y": float(y), "w": float(w), "h": float(h)}
    return out


# Kept in step with cardArtEra() in src/data/tcgArt.ts.
MID = {"xy", "bw", "dp", "pl", "hgss", "col", "pop"}
VINTAGE = {"base", "gym", "neo"}


def era_of(url):
    series = url.split("/")[4]
    if series in VINTAGE:
        return "era-vintage"
    if series in MID:
        return "era-mid"
    return None


def fetch(item):
    name, url = item
    path = os.path.join(CACHE, f"{name}.png")
    if os.path.exists(path):
        return
    urllib.request.urlretrieve(f"{url}/high.png", path)


def css_crop(im, rect):
    """The exact geometry of `.card-art`: an oversized, offset img box with
    `object-fit: cover`, of which the window shows the top-left WIN_W x WIN_H.
    Returns the visible region in source pixels, plus which axis cover trimmed."""
    ax, ay, aw, ah = rect["x"], rect["y"], rect["w"], rect["h"]
    box_w, box_h = WIN_W / aw, WIN_H / ah            # width / height
    off_x, off_y = -(ax / aw) * WIN_W, -(ay / ah) * WIN_H   # left / top
    src_w, src_h = im.size
    s = max(box_w / src_w, box_h / src_h)            # object-fit: cover
    ox = off_x + (box_w - src_w * s) / 2
    oy = off_y + (box_h - src_h * s) / 2
    trimmed = "width" if src_w / src_h > box_w / box_h else "HEIGHT"
    return ((0 - ox) / s, (0 - oy) / s, (WIN_W - ox) / s, (WIN_H - oy) / s), trimmed


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    art_map = json.load(open(ART_MAP, encoding="utf8"))
    rects, overrides = parse_rects(), parse_overrides()

    with ThreadPoolExecutor(12) as ex:
        list(ex.map(fetch, art_map.items()))

    names = sorted(art_map)
    cols = 6
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (WIN_W + 8) + 8, rows * (WIN_H + 26) + 8), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    flipped = []

    for i, name in enumerate(names):
        im = Image.open(os.path.join(CACHE, f"{name}.png")).convert("RGB")
        era = era_of(art_map[name])
        rect = overrides.get(name) or rects[era]
        (x0, y0, x1, y1), trimmed = css_crop(im, rect)
        # Vertical framing is only exact while cover trims width — see the
        # w/h >= 2.35 note in app.css. Anything else here is a real bug.
        if trimmed != "width":
            flipped.append(f"{name} [{era or 'modern'}] {im.size}")
        cell = im.crop((round(x0), round(y0), round(x1), round(y1)))
        cell = cell.resize((WIN_W, WIN_H), LANCZOS)
        x, y = 8 + (i % cols) * (WIN_W + 8), 8 + (i // cols) * (WIN_H + 26)
        sheet.paste(cell, (x, y))
        tag = f"{name}  [{art_map[name].split('/')[4]}]"
        if name in overrides:
            tag += "  (override)"
        draw.text((x + 2, y + WIN_H + 4), tag, fill=(220, 220, 220))

    # Six rows a sheet: one full-height PNG is too tall to look at usefully.
    per = 6
    for k in range(0, rows, per):
        top = 8 + k * (WIN_H + 26) - 8
        bottom = min(sheet.height, 8 + min(rows, k + per) * (WIN_H + 26))
        sheet.crop((0, top, sheet.width, bottom)).save(os.path.join(OUT, f"sheet_{k // per}.png"))

    print(f"{len(names)} cards -> {OUT}/sheet_*.png")
    if flipped:
        print("\ncover trimmed HEIGHT on these, so their top/bottom edges have")
        print("drifted — the era rect's w/h ratio is too low:")
        for f in flipped:
            print(f"  {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
