#!/usr/bin/env python3
"""Decode a saved browser tool-result file containing base64(JSON {slug: {..bracket.., desc}})
for the community tournaments. Writes data/tournaments/<slug>.json (bracket) and merges
each `desc` into data/descriptions.json.
Usage: python build/ingest_community.py <toolresult_file>
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TDIR = os.path.join(ROOT, "data", "tournaments")
DESC = os.path.join(ROOT, "data", "descriptions.json")

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

    descs = json.load(open(DESC, encoding="utf-8")) if os.path.exists(DESC) else {}
    for slug, t in data.items():
        desc = t.pop("desc", "")
        with open(os.path.join(TDIR, slug + ".json"), "w", encoding="utf-8") as f:
            json.dump(t, f, ensure_ascii=False)
        descs[slug] = desc
        print(f"  {slug:16} parts={len(t.get('participants',[]))} matches={len(t.get('matches',[]))} desc={len(desc)}ch")
    json.dump(descs, open(DESC, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"Merged descriptions -> {DESC}")

if __name__ == "__main__":
    main(sys.argv[1])
