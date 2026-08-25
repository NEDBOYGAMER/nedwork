import json, glob

for f in sorted(glob.glob("data/*.json")):
    try:
        with open(f, encoding="utf-8-sig") as fh:
            json.load(fh)
        print("OK  ", f)
    except Exception as e:
        print("BAD ", f, "->", e)