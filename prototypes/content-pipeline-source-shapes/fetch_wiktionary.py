"""PROTOTYPE (spike #44) — pull raw wikitext for the fixed word list, keep provenance."""
import json, pathlib, time, requests

WORDS = [w.strip() for w in open("words.txt") if w.strip()]
OUT = pathlib.Path("data/wiktionary"); OUT.mkdir(parents=True, exist_ok=True)
API = "https://en.wiktionary.org/w/api.php"
UA = "WordWell-spike/0.1 (design spike, contact cameron.webley@gmail.com)"

manifest = {"retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "api": API, "pages": {}}
s = requests.Session(); s.headers["User-Agent"] = UA

for i in range(0, len(WORDS), 20):
    batch = WORDS[i:i+20]
    r = s.get(API, params={"action": "query", "prop": "revisions", "rvslots": "main",
                           "rvprop": "content|ids|timestamp", "format": "json",
                           "formatversion": "2", "titles": "|".join(batch)}, timeout=60)
    r.raise_for_status()
    for page in r.json()["query"]["pages"]:
        title = page["title"]
        if "missing" in page:
            manifest["pages"][title] = {"missing": True}
            continue
        rev = page["revisions"][0]
        text = rev["slots"]["main"]["content"]
        (OUT / f"{title.replace(' ', '_')}.wikitext").write_text(text)
        manifest["pages"][title] = {"pageid": page["pageid"], "revid": rev["revid"],
                                    "rev_timestamp": rev["timestamp"], "bytes": len(text)}
    time.sleep(0.5)

pathlib.Path("data/wiktionary-manifest.json").write_text(json.dumps(manifest, indent=1))
got = sum(1 for v in manifest["pages"].values() if not v.get("missing"))
print(f"fetched {got}/{len(WORDS)} pages")
print("missing:", [k for k, v in manifest["pages"].items() if v.get("missing")])
