#!/usr/bin/env python3
"""Player pictures on the player pages (2026-11-12).

The user names picture files by the numbers in data/player_pictures.json (001.png, 002.jpg ...; the numbered
list they were given on 2026-11-10) and drops them in a folder outside the repo.

  python build/player_pictures.py <folder>
      makes site/assets/players/<number>.webp from each numbered picture: cropped to a square (the middle,
      a little above centre for tall ones), at most 256 x 256, never enlarged. Run it on each new batch,
      then build and publish as usual. Needs Pillow.

  attach(players, humans, site_dir, data_dir)   (called by parse.py on every build; no Pillow needed)
      gives each player with a picture a "photo" path. A number keeps its player through renames: it's
      matched by slug first, then by the player's name or an old name (aka).
"""
import hashlib, json, os, re, sys

SIZE = 256
EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _numbers(data_dir):
    with open(os.path.join(data_dir, "player_pictures.json"), encoding="utf-8") as f:
        return json.load(f)["numbers"]


def _out_dir(site_dir):
    return os.path.join(site_dir, "assets", "players")


def attach(players, humans, site_dir, data_dir):
    try:
        numbers = _numbers(data_dir)
    except (OSError, ValueError, KeyError):
        return
    folder = _out_dir(site_dir)
    everyone = list(players) + list(humans or [])
    by_slug = {p["slug"]: p for p in everyone if p.get("slug")}
    by_name = {}
    for p in everyone:
        for nm in [p.get("name")] + list(p.get("aka") or []):
            if nm:
                by_name.setdefault(nm.lower(), p)
    shown, lost = 0, []
    for n, who in numbers.items():
        f = os.path.join(folder, f"{n}.webp")
        if not os.path.exists(f):
            continue
        p = by_slug.get(who.get("slug")) or by_name.get((who.get("name") or "").lower())
        if not p:
            lost.append(f"{n} {who.get('name')}")
            continue
        with open(f, "rb") as fh:
            v = hashlib.md5(fh.read()).hexdigest()[:8]
        p["photo"] = f"assets/players/{n}.webp?v={v}"
        shown += 1
    print(f"player pictures: {shown}" + (f" (no player found for {', '.join(lost)})" if lost else ""))


def _square(im):
    w, h = im.size
    s = min(w, h)
    x = (w - s) // 2
    y = int((h - s) * 0.4)          # a tall picture keeps a bit more of its top, where faces usually are
    return im.crop((x, y, x + s, y + s))


def convert(src_dir, site_dir=os.path.join(ROOT, "site"), data_dir=os.path.join(ROOT, "data")):
    from PIL import Image, ImageOps
    numbers = _numbers(data_dir)
    out = _out_dir(site_dir)
    os.makedirs(out, exist_ok=True)
    made, small, unknown = [], [], []
    for name in sorted(os.listdir(src_dir)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in EXTS:
            continue
        if not re.fullmatch(r"\d{1,3}", stem):
            unknown.append(name)
            continue
        n = f"{int(stem):03d}"
        if n not in numbers:
            unknown.append(name)
            continue
        im = ImageOps.exif_transpose(Image.open(os.path.join(src_dir, name)))
        im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P", "PA") else im.convert("RGB")
        if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] == 255:
            im = im.convert("RGB")      # no see-through parts: a plain picture is smaller
        im = _square(im)
        if im.width > SIZE:
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        if im.width < 150:
            small.append(f"{n} ({im.width}px)")
        im.save(os.path.join(out, f"{n}.webp"), "WEBP", quality=86, method=6)
        made.append(n)
    total = sum(os.path.getsize(os.path.join(out, f"{n}.webp")) for n in made)
    print(f"made {len(made)} pictures in site/assets/players ({total // 1024} KB)")
    if small:
        print("small, so they'll look soft on the page:", ", ".join(small))
    if unknown:
        print("skipped (not a number on the list):", ", ".join(unknown))
    return made


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python build/player_pictures.py <folder of numbered pictures>")
    convert(sys.argv[1])
