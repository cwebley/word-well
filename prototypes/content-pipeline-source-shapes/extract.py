"""PROTOTYPE (spike #44) — one JSON record per word from every source. No schema intent."""
import json, pathlib, re, time
import wn
wn.config.data_directory = pathlib.Path("data/wn").resolve()
from wordfreq import zipf_frequency, get_frequency_list  # noqa: F401
import wordfreq

WORDS = [w.strip() for w in open("words.txt") if w.strip()]
OEWN = wn.Wordnet("oewn:2025")

# --- CMUdict -----------------------------------------------------------------
cmu = {}
for line in open("data/cmudict.dict"):
    line = line.split("#")[0].strip()
    if not line:
        continue
    head, _, phones = line.partition(" ")
    base = re.sub(r"\(\d+\)$", "", head)
    cmu.setdefault(base, []).append(phones)

# --- SCOWL size tiers --------------------------------------------------------
scowl_dir = pathlib.Path("data/scowl-2020.12.07/final")
scowl = {}
for f in sorted(scowl_dir.glob("english-words.*")) + sorted(scowl_dir.glob("american-words.*")) \
       + sorted(scowl_dir.glob("english-proper-names.*")) + sorted(scowl_dir.glob("american-proper-names.*")):
    size = int(f.suffix.lstrip("."))
    for w in f.read_text(encoding="iso-8859-1").split():
        scowl.setdefault(w, []).append((size, f.name))

records = {}
for word in WORDS:
    key = word.lower()
    entry = {"word": word}

    # frequency
    entry["zipf"] = zipf_frequency(word, "en")
    entry["zipf_large"] = zipf_frequency(word, "en", wordlist="large")

    # pronunciation
    entry["cmudict"] = cmu.get(key, [])
    if not entry["cmudict"] and " " in key:
        parts = [cmu.get(p, []) for p in key.split()]
        entry["cmudict_per_token"] = {p: cmu.get(p, []) for p in key.split()}

    # spelling tier
    tiers = sorted(set(scowl.get(word, []) + scowl.get(key, [])))
    entry["scowl_min_size"] = tiers[0][0] if tiers else None
    entry["scowl_lists"] = sorted({n for _, n in tiers})

    # OEWN
    senses = []
    for lemma in {word, key, key.replace(" ", "_")}:
        for w in OEWN.words(lemma):
            for s in w.senses():
                ss = s.synset()
                senses.append({
                    "sense_id": s.id, "pos": w.pos, "lemma": w.lemma(),
                    "synset_id": ss.id,
                    "definition": ss.definition(),
                    "examples": ss.examples(),
                    "members": [m.lemma() for m in ss.words()],
                    "ili": getattr(ss.ili, "id", ss.ili),
                })
    seen, dedup = set(), []
    for s in senses:
        if s["sense_id"] not in seen:
            seen.add(s["sense_id"]); dedup.append(s)
    entry["oewn_senses"] = dedup
    entry["oewn_sense_count"] = len(dedup)
    entry["oewn_pos_counts"] = {p: sum(1 for s in dedup if s["pos"] == p)
                                for p in sorted({s["pos"] for s in dedup})}

    records[word] = entry

meta = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "sources": {
        "oewn": {"release": "oewn:2025", "license": "CC BY 4.0",
                 "retrieved_via": "wn %s" % wn.__version__},
        "cmudict": {"release": "master @ sha256:81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22",
                    "url": "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict"},
        "scowl": {"release": "scowl-2020.12.07",
                  "sha256": "5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc"},
        "wordfreq": {"version": wordfreq.__version__ if hasattr(wordfreq, "__version__") else "3.1.1",
                     "lists": ["small", "large"]},
        "wiktionary": json.loads(pathlib.Path("data/wiktionary-manifest.json").read_text())["retrieved_at"],
    },
}
pathlib.Path("out/records.json").write_text(json.dumps({"meta": meta, "records": records}, indent=1))
print("words:", len(records))
print("no OEWN entry:", [w for w, r in records.items() if r["oewn_sense_count"] == 0])
print("no CMUdict entry:", [w for w, r in records.items() if not r["cmudict"]])
print("no SCOWL tier:", [w for w, r in records.items() if r["scowl_min_size"] is None])
