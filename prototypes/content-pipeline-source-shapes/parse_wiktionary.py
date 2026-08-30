"""PROTOTYPE (spike #44) — measure Wiktionary usage-label density and attachment level."""
import json, pathlib, re

WORDS = [w.strip() for w in open("words.txt") if w.strip()]
POS_HEADS = {"Noun", "Verb", "Adjective", "Adverb", "Interjection", "Preposition",
             "Conjunction", "Pronoun", "Determiner", "Numeral", "Phrase", "Proper noun",
             "Particle", "Prefix", "Suffix"}
LABEL_TPL = re.compile(r"\{\{(?:lb|lbl|label|tlb|term-label|qualifier|q|qual)\|en\|([^}]*)\}\}")

def english_section(text):
    m = re.search(r"^==\s*English\s*==\s*$", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    n = re.search(r"^==[^=].*==\s*$", rest, re.M)
    return rest[:n.start()] if n else rest

out = {}
for word in WORDS:
    path = pathlib.Path("data/wiktionary") / f"{word.replace(' ', '_')}.wikitext"
    en = english_section(path.read_text())
    pos, senses, headword_labels = None, [], []
    for line in en.splitlines():
        h = re.match(r"^={3,5}\s*([^=]+?)\s*={3,5}\s*$", line)
        if h:
            pos = h.group(1) if h.group(1) in POS_HEADS else None
            continue
        if pos and re.match(r"^\{\{en-", line):          # headword template line
            headword_labels += [l for m in LABEL_TPL.finditer(line) for l in m.group(1).split("|")]
        if pos and re.match(r"^#[^:*#]", line):          # a sense line, not a quote/example
            labels = [l.strip() for m in LABEL_TPL.finditer(line) for l in m.group(1).split("|") if l.strip()]
            gloss = re.sub(r"\{\{[^}]*\}\}", "", line[1:]).replace("[[", "").replace("]]", "")
            gloss = re.sub(r"\s+", " ", gloss.replace("'''", "").replace("''", "")).strip()
            senses.append({"pos": pos, "labels": labels, "gloss": gloss})
    out[word] = {"senses": senses, "sense_count": len(senses),
                 "labelled_senses": sum(1 for s in senses if s["labels"]),
                 "headword_labels": headword_labels,
                 "all_labels": sorted({l for s in senses for l in s["labels"]})}

pathlib.Path("out/wiktionary-labels.json").write_text(json.dumps(out, indent=1))

tot_s = sum(v["sense_count"] for v in out.values())
tot_l = sum(v["labelled_senses"] for v in out.values())
words_with = sum(1 for v in out.values() if v["labelled_senses"])
print(f"words: {len(out)}  senses: {tot_s}  labelled senses: {tot_l} ({tot_l/tot_s:.0%})")
print(f"words with >=1 labelled sense: {words_with}/{len(out)} ({words_with/len(out):.0%})")
print(f"labels found on headword template lines: {sum(len(v['headword_labels']) for v in out.values())}")
print()
print(f"{'word':16} {'senses':>6} {'labelled':>8}  labels")
for w in WORDS:
    v = out[w]
    print(f"{w:16} {v['sense_count']:6d} {v['labelled_senses']:8d}  {', '.join(v['all_labels'])[:80]}")
