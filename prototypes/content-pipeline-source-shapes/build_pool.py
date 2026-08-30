"""PROTOTYPE (spike #44) — deduplicate wordfreq to OEWN lemmas and score every candidate filter.

Scratch only. Not a schema. Every filter is a COLUMN, never a deletion, so the
browser can turn each one on and off against live samples.
"""
import collections, math, pathlib, re, sqlite3, time, wn
wn.config.data_directory = pathlib.Path("data/wn").resolve()
from wn.morphy import Morphy
from wordfreq import get_frequency_dict

t0 = time.time()
en = wn.Wordnet("oewn:2025")
morphy = Morphy(en)
freq = get_frequency_dict("en", wordlist="large")
SCOWL = pathlib.Path("data/scowl-2020.12.07/final")

# case-insensitive lemma map: 'schadenfreude' -> 'Schadenfreude'
canon = {}
for w in en.words():
    l = w.lemma()
    k = l.lower()
    if k not in canon or (l.islower() and not canon[k].islower()):
        canon[k] = l
print(f"OEWN lemmas {len(canon):,} (case-folded)")

def scowl_set(*prefixes, keep_case=False):
    out = set()
    for pre in prefixes:
        for p in SCOWL.glob(f"{pre}.*"):
            for w in p.read_text(encoding="iso-8859-1").split():
                w = w.rstrip(".")
                # SCOWL's abbreviation lists hold uppercase acronyms (AND, CAR, NEWS).
                # Folding those to lowercase would exclude the ordinary words.
                if keep_case and w != w.lower():
                    continue
                out.add(w.lower())
    return out
abbrev   = scowl_set("*-abbreviations", keep_case=True)
roman    = scowl_set("special-roman-numerals")
RE_ROMAN = re.compile(r"^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")
def is_roman(w):
    return bool(w) and (w in roman or RE_ROMAN.match(w) is not None)
british  = scowl_set("british-words", "british_*-words", "canadian-words", "australian-words")
american = scowl_set("american-words", "english-words")
variant  = scowl_set("variant_*-words")

# --- dedupe surface forms onto lemmas (keyed on the lowercase form) -----------
own, inflected = {}, collections.defaultdict(float)
forms_of, ambiguous, skipped = collections.defaultdict(list), [], 0
for form, f in freq.items():
    if not form.isalpha() or not form.islower() or len(form) < 3 or form in abbrev:
        skipped += 1; continue
    if form in canon:
        own[form] = f; continue
    cands = {l.lower() for s in morphy(form, None).values() for l in s
             if l.lower() != form and l.lower() in canon}
    if len(cands) == 1:
        lemma = cands.pop(); inflected[lemma] += f; forms_of[lemma].append(form)
    elif len(cands) > 1:
        ambiguous.append((form, f, ",".join(sorted(cands))))
    else:
        skipped += 1
zipf_of = {l: math.log10((own.get(l, 0.0) + inflected.get(l, 0.0)) * 1e9)
           for l in set(own) | set(inflected) if own.get(l, 0.0) + inflected.get(l, 0.0) > 0}
print(f"lemmas with frequency {len(zipf_of):,}  ambiguous {len(ambiguous):,}  dropped {skipped:,}")

# --- filter features ----------------------------------------------------------
# Chosen by GRE-word density (share of each category's pool words that eleven study
# guides endorse), not by eye. verb.change 9.3% and verb.possession 12.0% beat
# noun.state 4.3%, which was already in; excluding them cost `transmute`, `coalesce`,
# `burgeon`, `abate` and `ameliorate`.
ABSTRACT = {"adj.all","noun.attribute","noun.cognition","noun.communication","noun.feeling",
            "noun.state","noun.act","noun.motive","noun.event","verb.emotion",
            "verb.communication","verb.social","verb.cognition","verb.stative",
            "verb.change","verb.possession","verb.contact","noun.person",
            "noun.group","adj.pert"}
BLOCK = {"disease","illness","symptom","pathology","infection","physical_condition",
         "bodily_process","organic_process","sport","game","religion","punctuation"}
PRE = ["un","in","im","ir","il","non","de","re","over","under","anti","micro","macro","pre",
       "post","semi","sub","super","multi","inter","counter","dis","mis","out"]
SUF = ["ly","ness","ity","er","or","ist","ism","ation","ification","ment","able","ible",
       "ful","less","ish","ing","ed","al","ic","ive","ise","ize","ify","dom","hood","ship"]
ROOT_KNOWN = 3.0   # above this the learner surely knows the root, so the derivation teaches nothing

def affix_root(w):
    """A word is transparent if a commoner word is left after stripping an affix.

    The ROOT_KNOWN guard applies to every affix, prefix and suffix alike. The filter's
    claim is "you already know the root, so this teaches nothing new" — and that claim
    needs the root to actually be known. `de-` + `fenestration` (1.96) and `slattern`
    (1.49) + `-ly` both fail it: nobody knows either root, so both words do teach
    something. The cost is that `wistfully` survives alongside `wistful` (2.71).
    """
    z = zipf_of[w]
    for p in PRE:
        root = w[len(p):]
        if (w.startswith(p) and len(root) >= 3
                and zipf_of.get(root, -9) > z and zipf_of.get(root, -9) >= ROOT_KNOWN):
            return root
    for s in SUF:
        if w.endswith(s) and len(w)-len(s) >= 4:
            for c in (w[:-len(s)], w[:-len(s)]+"e", w[:-len(s)-1]+"y" if len(w)-len(s) > 4 else None):
                if c and zipf_of.get(c, -9) > z and zipf_of.get(c, -9) >= ROOT_KNOWN:
                    return c
    return None

# Suffixes that only change grammatical shape. `saintliness` follows from `saintly`;
# `industrious` does NOT follow from `industry`, so -ous and friends are excluded here.
GRAM_SUFFIX = ("ness", "ity", "ly", "ment", "y")
DRIFT_SUFFIX = ("ous", "ic", "al", "ial", "ible", "able", "ify", "ive",
                "ent", "ant", "ary", "ory", "ate", "ism", "ist")

def deriv_root(w):
    """OEWN's derivation links, gated on the root being known AND actually being a root.

    WordNet's derivation links are undirected, so `rebuttal` was condemning `rebut`
    and `atonement` was condemning `atone`. A source is shorter than the word built
    from it, which is a crude but effective direction test.
    """
    best = None
    for s in en.senses(canon[w]):
        for rel, ts in s.relations().items():
            if "derivation" in rel:
                for t in ts:
                    l = t.word().lemma().lower()
                    if (l != w and len(l) < len(w)
                            and zipf_of.get(l, -9) >= ROOT_KNOWN and zipf_of[l] > zipf_of[w]):
                        if best is None or zipf_of[l] > zipf_of[best]: best = l
    return best

SUFFIX_WORDS = {"some","tory","ate","age","ant","ent","ist","ism","ary","ory","less",
                "ful","ness","ship","hood","dom","like","ward","wise","able","ible",
                "ling","let","ery","ory","ine","ile","ure","ance","ence","tion","sion"}

def compound(w):
    """Both halves must be real words of real length.

    A 3-letter tail lets suffixes masquerade as words — `discord`+`ant`,
    `react`+`ant` — so require 4 characters on each side.
    """
    for i in range(4, len(w) - 3):
        a, b = w[:i], w[i:]
        if b in SUFFIX_WORDS or a in SUFFIX_WORDS:
            continue
        if zipf_of.get(a, -9) > 3.0 and zipf_of.get(b, -9) > 3.0:
            return a + "+" + b
    return None

def blocked(ss):
    for path in ss.hypernym_paths()[:3]:
        for node in path:
            if BLOCK & {l.replace(" ", "_") for l in node.lemmas()}: return 1
    return 0

scowl_tier = {}
for p in SCOWL.glob("*-words.*"):
    size = int(p.suffix.lstrip("."))
    for w in p.read_text(encoding="iso-8859-1").split():
        k = w.lower()
        if size < scowl_tier.get(k, 999): scowl_tier[k] = size

import json
nom_path = pathlib.Path("out/nominations.json")
nominations = json.loads(nom_path.read_text())["counts"] if nom_path.exists() else {}
print(f"nomination lists loaded: {len(nominations):,} endorsed words")

db = pathlib.Path("out/pool.sqlite"); db.unlink(missing_ok=True)
con = sqlite3.connect(db)
con.executescript("""
CREATE TABLE lemma (
  lemma TEXT PRIMARY KEY, display TEXT, zipf_own REAL, zipf_summed REAL, lift REAL,
  pos TEXT, lexfile TEXT, oewn_senses INTEGER, synset_max INTEGER,
  scowl_tier INTEGER, n_forms INTEGER, len INTEGER, dominant_form TEXT, dominant_share REAL,
  f_abstract INT, f_transparent INT, transparent_root TEXT, f_derived INT, derived_root TEXT,
  f_compound INT, compound_parts TEXT, f_blocked INT, f_no_synonyms INT,
  f_derived_soft INT,
  f_roman INT, f_variant INT, f_british INT, f_ology INT, f_participial INT,
  f_informal INT, wik_labels TEXT, wik_first TEXT, endorsements INT
);
CREATE TABLE ambiguous_form (form TEXT PRIMARY KEY, freq REAL, candidates TEXT);
""")

rows = []
for lemma, z in zipf_of.items():
    if len(lemma) < 3 or lemma in abbrev or not lemma.isalpha(): continue
    disp = canon[lemma]
    # An initialism capitalises more than its first letter. Case-insensitive lemma
    # matching is what lets `schadenfreude` reach `Schadenfreude`; it also lets
    # `sgml` reach `SGML`, and this is what tells those two apart.
    if any(c.isupper() for c in disp[1:]): continue
    words = en.words(disp)
    ss = en.synsets(disp)
    first = ss[0] if ss else None
    senses = sum(len(w.senses()) for w in words)
    sizes = [len(s.synset().words()) for w in words for s in w.senses()]
    aroot, droot, comp = affix_root(lemma), deriv_root(lemma), compound(lemma)
    # a derivation that only changes grammatical shape is safe to drop; one that can
    # carry new meaning (industry -> industrious) gets its own, off-by-default flag
    w_gram = bool(droot) and lemma.endswith(GRAM_SUFFIX)
    # the same distinction has to hold for affix stripping: `mercurial` strips to
    # `mercury`, but "volatile in temperament" no more follows from mercury than
    # "diligent" follows from industry. Only grammatical affixes are hard removals.
    a_soft = bool(aroot) and lemma.endswith(DRIFT_SUFFIX) and not lemma.endswith(GRAM_SUFFIX)
    # A participle that OEWN files as its own adjective has lexicalised, and lexicalised
    # participles drift: `exacting` is not "precise-ing", `fleeting` has nothing to do
    # with fleets. Treat them like `industrious` — a soft flag, not a hard removal.
    if lemma.endswith(("ing", "ed")) and first is not None and first.pos in "as":
        a_soft = True
    cands = [(own.get(lemma, 0.0), lemma)] + [(freq[f], f) for f in forms_of.get(lemma, [])]
    dom_freq, dom_form = max(cands)
    total = own.get(lemma, 0.0) + inflected.get(lemma, 0.0)
    zo = math.log10(own[lemma] * 1e9) if own.get(lemma) else None
    def _base_verb(l):
        for c in (l[:-2], l[:-3], l[:-3] + "e"):
            if c and any(x.pos == "v" for x in en.words(c)):
                return c
        return None
    _b = _base_verb(lemma) if lemma.endswith(("ed", "ing")) else None
    participial = int(bool(first) and first.pos in "as" and _b is not None
                      and zipf_of.get(_b, -9) > z and zipf_of.get(_b, -9) >= ROOT_KNOWN)
    rows.append((lemma, disp, round(zo,3) if zo else None, round(z,3),
                 round(z-zo,3) if zo else None,
                 ",".join(sorted({w.pos for w in words if w.pos})),
                 first.lexfile() if first else None, senses, max(sizes) if sizes else 0,
                 scowl_tier.get(lemma), 1+len(forms_of.get(lemma, [])), len(lemma),
                 dom_form, round(dom_freq/total, 3),
                 int(any(s.lexfile() in ABSTRACT for s in ss)),
                 int(aroot is not None and not a_soft), aroot, int(w_gram), droot,
                 int(comp is not None), comp, blocked(first) if first else 0,
                 int(bool(sizes) and max(sizes) == 1),
                 int((bool(droot) and not w_gram) or a_soft or participial),
                 int(is_roman(lemma)), int(lemma in variant and lemma not in american),
                 int(lemma in british and lemma not in american),
                 int(lemma.endswith(("ology","ologies","ography","onomy"))),
                 0 if a_soft else participial, 0, None, None, nominations.get(lemma, 0)))

con.executemany("INSERT INTO lemma VALUES (" + ",".join("?"*33) + ")", rows)
con.executemany("INSERT OR IGNORE INTO ambiguous_form VALUES (?,?,?)", ambiguous)
con.execute("CREATE INDEX lemma_zipf_idx ON lemma(zipf_summed)")
con.commit()
print(f"wrote {len(rows):,} rows in {time.time()-t0:.0f}s")
q = lambda s: con.execute(s).fetchone()[0]
band = "zipf_summed>=1.5 AND zipf_summed<4.5"
print(f"in band {q(f'SELECT count(*) FROM lemma WHERE {band}'):,}")
for c in ["f_abstract=0","f_transparent=1","f_derived=1","f_compound=1","f_blocked=1",
          "f_no_synonyms=1","f_roman=1","f_variant=1","f_british=1","f_ology=1","f_participial=1"]:
    print(f"  {c:18} removes {q(f'SELECT count(*) FROM lemma WHERE {band} AND {c}'):7,}")
DEFAULT = """f_abstract=1 AND f_transparent=0 AND f_derived=0 AND f_compound=0 AND f_blocked=0
             AND f_roman=0 AND f_variant=0 AND f_british=0 AND f_ology=0 AND f_participial=0"""
print(f"\nsurvivors (no-synonyms gate DROPPED): {q(f'SELECT count(*) FROM lemma WHERE {band} AND {DEFAULT}'):,}")
for w in ["schadenfreude","aplomb","umbrage","ennui","torpid","impetuosity","naughtiness",
          "dignify","serfdom","threadbare","deathblow","zippy"]:
    r = con.execute(f"SELECT lemma FROM lemma WHERE lemma=? AND {DEFAULT}", (w,)).fetchone()
    inp = con.execute("SELECT display, zipf_summed FROM lemma WHERE lemma=?", (w,)).fetchone()
    print(f"  {w:15} {'in pool ' + inp[0] + f' {inp[1]:.2f}' if inp else 'NOT IN POOL':32} survives: {bool(r)}")
