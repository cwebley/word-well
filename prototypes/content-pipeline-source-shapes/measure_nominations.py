"""PROTOTYPE (spike #44) — nomination resolution rate: what survives from a real editorial list."""
import json, pathlib, re, wn
wn.config.data_directory = pathlib.Path("data/wn").resolve()
from wordfreq import zipf_frequency
en = wn.Wordnet("oewn:2025")

nom = json.loads(pathlib.Path("out/nom-wiktionary-wotd.json").read_text())
words = nom["headwords"]
N = len(words)

def resolves(w):
    for lemma in {w, w.lower(), w.replace(" ", "_"), w.lower().replace(" ", "_")}:
        if en.words(lemma): return True
    return False

multi = [w for w in words if " " in w or "-" in w]
capital = [w for w in words if w[:1].isupper() and w.lower() != w]
single_lower = [w for w in words if w not in multi and w not in capital]
resolved = [w for w in words if resolves(w)]
res_single = [w for w in single_lower if resolves(w)]

print(f"nomination source A: {nom['source']}")
print(f"  headwords: {N}")
print(f"  multiword or hyphenated: {len(multi)} ({len(multi)/N:.0%})")
print(f"  capitalised (proper-noun shaped): {len(capital)} ({len(capital)/N:.0%})")
print(f"  plain single lowercase headwords: {len(single_lower)} ({len(single_lower)/N:.0%})")
print(f"  resolve to an OEWN lemma: {len(resolved)}/{N} ({len(resolved)/N:.0%})")
print(f"  ... restricted to plain single headwords: {len(res_single)}/{len(single_lower)} ({len(res_single)/len(single_lower):.0%})")

z = {w: zipf_frequency(w, "en") for w in single_lower}
in_band = [w for w in single_lower if 0 < z[w] < 4.5]
zero = [w for w in single_lower if z[w] == 0]
print(f"  zipf == 0 (absent from wordfreq entirely): {len(zero)} ({len(zero)/len(single_lower):.0%})")
print(f"  below the proposed 4.5 ceiling and non-zero: {len(in_band)} ({len(in_band)/len(single_lower):.0%})")
survive = [w for w in in_band if resolves(w)]
print(f"  survive BOTH the band and OEWN resolution: {len(survive)}/{N} = {len(survive)/N:.0%} of the raw list")
print("\n  sample of what a naive intake would have swallowed:")
print("   ", ", ".join(multi[:12]))
print("   ", ", ".join(capital[:12]))
print("\n  sample surviving candidates:", ", ".join(sorted(survive)[:20]))
pathlib.Path("out/nomination-measure.json").write_text(json.dumps(
  {"source": nom["source"], "n": N, "multiword": len(multi), "capitalised": len(capital),
   "plain": len(single_lower), "resolved": len(resolved), "resolved_plain": len(res_single),
   "zipf_zero": len(zero), "in_band": len(in_band), "survive_both": len(survive),
   "survivors": sorted(survive)}, indent=1))
