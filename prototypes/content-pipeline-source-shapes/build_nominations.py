"""PROTOTYPE (spike #44) — combine every editorial vocabulary list into one nomination table."""
import csv, json, pathlib, re, collections
from pypdf import PdfReader

lists = {}

# 1. GRE aggregation sheet — eight independent guides, one column each
rows = list(csv.reader(open("gre.csv")))
head = [h.strip() for h in rows[0]][1:]
for i, name in enumerate(head):
    s = set()
    for r in rows[1:]:
        if i + 1 < len(r):
            w = r[i + 1].strip().lower()
            if w and w.isalpha():
                s.add(w)
    lists["GRE: " + name] = s

# 2. Acely SAT guide
h = pathlib.Path("acely.html").read_text(encoding="utf-8", errors="replace")
acely = {m.group(1).lower() for m in
         re.finditer(r'text-navy-900">([A-Za-z]+)<!-- --> [–-]', h)}
lists["SAT: Acely"] = acely

# 3. Mometrix Top 50 SAT PDF — headwords are syllabified with middle dots
txt = "\n".join(p.extract_text() for p in PdfReader("mometrix.pdf").pages)
# body pages list entries as "word (verb)"; page 1 shows a few syllabified with middle dots
mome = {m.group(1).lower() for m in
        re.finditer(r"^\s*([A-Za-z]+)\s*\((?:verb|noun|adjective|adverb)\)", txt, re.M)}
mome |= {re.sub(r"[^a-z]", "", w.lower()) for w in re.findall(r"\b[a-zA-Z]+(?:·[a-zA-Z]+)+\b", txt)}
lists["SAT: Mometrix"] = {w for w in mome if len(w) > 3}

# 4. vocabulary.com "Words to Capture Tone"
h = pathlib.Path("vocabcom.html").read_text(encoding="utf-8", errors="replace")
# the page renders the list in several <ul class="words"> blocks, not one
vc = set()
for block in re.findall(r'<ul class="words">(.*?)</ul>', h, re.S):
    vc |= {m.group(1).lower() for m in re.finditer(r'/dictionary/([a-zA-Z]+)"', block)}
lists["Tone: vocabulary.com"] = vc

# 5. Test Ninjas ACT tiers — medium and hard only; the easy tier is below our floor
for tier, fn in [("medium", "03-act-medium-words-99-words.pdf"),
                 ("hard", "02-act-hard-words-99-words.pdf")]:
    if not pathlib.Path(fn).exists():
        continue
    txt = "\n".join(p_.extract_text() for p_ in PdfReader(fn).pages)
    ws = {m.group(1).lower() for m in
          re.finditer(r"^\d{3}\s+([A-Za-z]+)\s+(?:noun|verb|adjective|adverb)\s*·", txt, re.M)}
    lists[f"ACT: Test Ninjas {tier}"] = ws

# 6. College Transitions 175 ACT words (the site blocks automated fetches)
ct = pathlib.Path("collegetransitions-act-175.txt")
if ct.exists():
    lists["ACT: College Transitions"] = {w for w in ct.read_text().split() if w.isalpha()}

for k, v in lists.items():
    print(f"  {k:32} {len(v):5,}")
allw = sorted(set().union(*lists.values()))
print(f"\nunique words across all {len(lists)} lists: {len(allw):,}")
counts = {w: sum(1 for s in lists.values() if w in s) for w in allw}
pathlib.Path("out/nominations.json").write_text(json.dumps(
    {"sources": list(lists), "lists": {k: sorted(v) for k, v in lists.items()},
     "counts": counts}, indent=0))
d = collections.Counter(counts.values())
print("recommendation counts:", " ".join(f"{k}x:{v}" for k, v in sorted(d.items())))
