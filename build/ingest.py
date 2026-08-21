#!/usr/bin/env python3
"""Ingest a saved browser tool-result file containing base64(JSON of tournaments)
and split it into data/tournaments/<slug>.json.

Usage: python build/ingest.py <toolresult_file> [<toolresult_file> ...]
The browser returns 'LEN=<n>|<base64>'; base64 decodes to a JSON array of
{slug, type, state, roundTitles, participants, matches}.
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "tournaments")
os.makedirs(OUT, exist_ok=True)

def extract_text(path):
    raw = open(path, encoding="utf-8", errors="replace").read()
    # file is usually a JSON array [{"type":"text","text":"..."}]
    try:
        arr = json.loads(raw)
        if isinstance(arr, list):
            return "".join(seg.get("text", "") for seg in arr if isinstance(seg, dict))
    except Exception:
        pass
    return raw

def main(paths):
    total = 0
    for p in paths:
        text = extract_text(p)
        m = re.search(r"LEN=(\d+)\|", text)
        if not m:
            print(f"  !! {p}: no LEN marker"); continue
        n = int(m.group(1))
        tail = re.sub(r"[^A-Za-z0-9+/=]", "", text[m.end():])  # strip quotes/newlines
        b64 = tail[:n]  # exactly the reported base64 length; drops appended tool noise
        data = json.loads(base64.b64decode(b64).decode("utf-8"))
        for t in data:
            slug = t.get("slug", "unknown")
            if t.get("error"):
                print(f"  !! {slug}: {t['error']}")
                continue
            with open(os.path.join(OUT, slug + ".json"), "w", encoding="utf-8") as f:
                json.dump(t, f, ensure_ascii=False)
            nm = len(t.get("matches", []))
            npart = len(t.get("participants", []))
            print(f"  ok {slug:22} {t.get('type',''):20} parts={npart:<3} matches={nm}")
            total += 1
    print(f"Wrote {total} tournaments -> {OUT}")

if __name__ == "__main__":
    main(sys.argv[1:])
