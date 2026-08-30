"""PROTOTYPE (spike #44) — Wiktionary Word of the Day headwords as nomination source A."""
import json, pathlib, re, time, requests
s = requests.Session(); s.headers["User-Agent"] = "WordWell-spike/0.1 (cameron.webley@gmail.com)"
API = "https://en.wiktionary.org/w/api.php"

titles = []
for year in ["2024", "2025", "2026"]:
    cont = {}
    while True:
        p = {"action": "query", "list": "allpages", "apprefix": f"Word of the day/{year}",
             "apnamespace": "4", "aplimit": "500", "format": "json", "formatversion": "2", **cont}
        r = s.get(API, params=p, timeout=60).json()
        titles += [x["title"] for x in r["query"]["allpages"]]
        if "continue" not in r: break
        cont = r["continue"]; time.sleep(0.3)

words, missing = [], 0
for i in range(0, len(titles), 50):
    r = s.get(API, params={"action": "query", "prop": "revisions", "rvslots": "main",
                           "rvprop": "content", "format": "json", "formatversion": "2",
                           "titles": "|".join(titles[i:i+50])}, timeout=60).json()
    for page in r["query"]["pages"]:
        if "missing" in page: missing += 1; continue
        txt = page["revisions"][0]["slots"]["main"]["content"]
        m = re.search(r"\{\{WOTD\|([^|}]+)", txt) or re.search(r"\|\s*word\s*=\s*([^\n|}]+)", txt)
        if m: words.append(m.group(1).strip())
    time.sleep(0.3)

uniq = sorted({w for w in words if w})
pathlib.Path("out/nom-wiktionary-wotd.json").write_text(json.dumps(
    {"source": "Wiktionary:Word of the day 2024-2026", "license": "CC BY-SA 4.0 / GFDL",
     "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
     "day_pages": len(titles), "headwords": uniq}, indent=1))
print(f"day pages: {len(titles)}  headwords parsed: {len(words)}  unique: {len(uniq)}")
print("sample:", uniq[:15])
