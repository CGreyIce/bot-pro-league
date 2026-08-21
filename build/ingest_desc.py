#!/usr/bin/env python3
"""Decode a saved browser tool-result file containing base64(JSON {slug: description_text})
into data/descriptions.json."""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "descriptions.json")

def extract_text(path):
    raw = open(path, encoding="utf-8", errors="replace").read()
    try:
        arr = json.loads(raw)
        if isinstance(arr, list):
            return "".join(seg.get("text", "") for seg in arr if isinstance(seg, dict))
    except Exception:
        pass
    return raw

def main(path):
    text = extract_text(path)
    m = re.search(r"LEN=(\d+)\|", text)
    n = int(m.group(1))
    b64 = re.sub(r"[^A-Za-z0-9+/=]", "", text[m.end():])[:n]
    data = json.loads(base64.b64decode(b64).decode("utf-8"))
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Wrote {len(data)} descriptions -> {OUT}")
    for slug, t in data.items():
        print(f"  {slug:22} {len(t)} chars")

if __name__ == "__main__":
    main(sys.argv[1])
