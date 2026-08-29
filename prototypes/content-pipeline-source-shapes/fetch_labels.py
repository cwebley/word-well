"""PROTOTYPE (spike #44) — Wiktionary register labels for the words that survive the filters."""
import re, sqlite3, time, requests

DEFAULT = """f_abstract=1 AND f_transparent=0 AND f_derived=0 AND f_compound=0 AND f_blocked=0
             AND f_roman=0 AND f_variant=0 AND f_british=0 AND f_ology=0 AND f_participial=0"""
con = sqlite3.connect("out/pool.sqlite")
words = [r[0] for r in con.execute(
    f"SELECT display FROM lemma WHERE zipf_summed>=1.0 AND zipf_summed<3.8 AND {DEFAULT}")]
print(f"fetching labels for {len(words):,} survivors ({len(words)//50 + 1} requests)")

# Register only. Currency labels (archaic/obsolete/dated) are deliberately NOT here:
# the spike measured 26 of them sitting on minor senses of plainly current words.
REJECT = {"informal","colloquial","slang","vulgar","offensive","childish",
          "ethnic slur","slur","internet slang","text messaging"}
LABEL = re.compile(r"\{\{(?:lb|lbl|label)\|en\|([^}]*)\}\}")
SEP = {"_","or","and","also",""}
s = requests.Session(); s.headers["User-Agent"] = "WordWell-spike/0.1 (cameron.webley@gmail.com)"

def english(t):
    m = re.search(r"^==\s*English\s*==\s*$", t, re.M)
    if not m: return ""
    e = t[m.end():]; n = re.search(r"^==[^=].*==\s*$", e, re.M)
    return e[:n.start()] if n else e

out, missing = {}, 0
for i in range(0, len(words), 50):
    batch = words[i:i+50]
    try:
        r = s.get("https://en.wiktionary.org/w/api.php", params={
            "action":"query","prop":"revisions","rvslots":"main","rvprop":"content",
            "format":"json","formatversion":"2","titles":"|".join(batch)}, timeout=60).json()
    except Exception as e:
        print("  request failed:", e); continue
    for page in r.get("query", {}).get("pages", []):
        title = page["title"]
        if "missing" in page: missing += 1; continue
        en_sec = english(page["revisions"][0]["slots"]["main"]["content"])
        senses = [l for l in en_sec.splitlines() if re.match(r"^#[^:*#]", l)]
        if not senses: continue
        first = [x.strip() for m in LABEL.finditer(senses[0]) for x in m.group(1).split("|")
                 if x.strip() not in SEP]
        alll = [x.strip() for ln in senses for m in LABEL.finditer(ln)
                for x in m.group(1).split("|") if x.strip() not in SEP]
        out[title] = (int(bool(REJECT & set(first))), ",".join(sorted(set(alll)))[:200],
                      ",".join(sorted(set(first)))[:120])
    if (i // 50) % 20 == 0:
        print(f"  {i+len(batch):,}/{len(words):,}")
    time.sleep(0.4)

try:
    con.execute("ALTER TABLE lemma ADD COLUMN wik_first TEXT")
except Exception:
    pass
con.executemany("UPDATE lemma SET f_informal=?, wik_labels=?, wik_first=? WHERE display=?",
                [(v[0], v[1], v[2], k) for k, v in out.items()])
con.commit()
print(f"\nlabelled {len(out):,}; no Wiktionary page {missing:,}")
q = lambda s_: con.execute(s_).fetchone()[0]
print(f"first sense carries a reject-register label: {q('SELECT count(*) FROM lemma WHERE f_informal=1'):,}")
for w in ["zippy","grotty","punny","blahs","clusterfuck","ennui","umbrage","aplomb","torpid"]:
    r = con.execute("SELECT f_informal, wik_labels FROM lemma WHERE lemma=?", (w,)).fetchone()
    if r: print(f"  {w:14} informal={r[0]}  labels={(r[1] or '-')[:70]}")
