"""PROTOTYPE (spike #44) — every editorially-recommended word, in Zipf order, with its endorsement count."""
import datetime, json, pathlib, sqlite3

nom = json.loads(pathlib.Path("out/nominations.json").read_text())
counts, sources, lists = nom["counts"], nom["sources"], nom["lists"]
by_word = {w: [s for s in sources if w in set(lists[s])] for w in counts}

con = sqlite3.connect("out/pool.sqlite")
info = {r[0]: r[1:] for r in con.execute(
    """SELECT lemma, zipf_summed, pos, lexfile, f_abstract, f_transparent, f_derived,
              f_compound, f_blocked, f_informal, f_participial, f_british, f_variant,
              f_ology, f_roman FROM lemma""")}
FLAGNAMES = ["not abstract","transparent","derived (grammatical)","compound","blocked hypernym",
             "informal","participial","British-only","spelling variant","-ology","roman numeral"]

data = []
for w, n in counts.items():
    r = info.get(w)
    if r:
        z, pos, lex = r[0], r[1] or "", r[2] or ""
        flags = [FLAGNAMES[i] for i, v in enumerate(r[3:])
                 if (v == 0 if i == 0 else v == 1)]
        # an endorsed word is not removed by a mere morphology guess
        if n > 0 and flags and all("transparent" in f or "compound" in f or "derived" in f
                                   for f in flags):
            flags = []
    else:
        z, pos, lex, flags = None, "", "", []
    data.append([w, z, pos, lex.replace("noun.","n.").replace("verb.","v.").replace("adj.","a.").replace("adv.","r."),
                 n, by_word[w], flags])
data.sort(key=lambda r: (-(r[1] if r[1] is not None else -1)))
print(f"{len(data):,} nominated words; {sum(1 for d in data if d[1] is None):,} absent from the pool")

html = pathlib.Path("nominations_browser.html")
html.write_text("""<!doctype html>
<!-- PROTOTYPE ONLY (spike #44): editorially nominated words in Zipf order. Throwaway. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nominated words by frequency</title><style>
@import url("https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=Literata:opsz,wght@7..72,200..900&display=swap");
:root{--ink:oklch(25% .035 205);--paper:oklch(98% .012 165);--stone:oklch(91% .015 200);
--water:oklch(45% .075 205);--moss:oklch(45% .075 145);--wood:oklch(45% .075 45);
--line:color-mix(in oklab,var(--water),transparent 60%);--sans:"Instrument Sans",sans-serif;--serif:Literata,Georgia,serif}
*{box-sizing:border-box}body{margin:0;background:var(--stone);color:var(--ink);font-family:var(--sans);font-size:14px}
header{background:var(--water);color:var(--paper);padding:1rem 1.4rem}
h1{font-family:var(--serif);font-size:1.4rem;font-weight:520;margin:0;letter-spacing:-.03em}
header p{margin:.3rem 0 0;opacity:.85;font-size:.8rem}
main{padding:1.1rem;max-width:1200px;margin:0 auto}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1.1rem;margin-bottom:.9rem}
.controls{display:flex;gap:1.2rem;flex-wrap:wrap;align-items:flex-end}
label.cap{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-bottom:.18rem}
input,select{font:inherit;padding:.3rem .45rem;border:1px solid var(--line);border-radius:.3rem;background:var(--paper);color:inherit}
table{width:100%;border-collapse:collapse;font-size:.87rem}
th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;opacity:.7;
   padding:.35rem .5rem;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--paper)}
td{padding:.28rem .5rem;border-bottom:1px solid color-mix(in oklab,var(--line),transparent 55%)}
td.w{font-weight:600}td.z{font-variant-numeric:tabular-nums}
tr.over{background:color-mix(in oklab,var(--wood),transparent 90%)}
tr.gone td.w{text-decoration:line-through;opacity:.65}
.pill{display:inline-block;background:var(--stone);border-radius:.6rem;padding:.02rem .4rem;font-size:.74rem;margin-right:.2rem}
.n{font-variant-numeric:tabular-nums;font-weight:600}
.note{font-size:.75rem;opacity:.72}
</style></head><body>
<header><h1>Nominated words by frequency</h1>
<p>Spike #44 &middot; PROTOTYPE &middot; every word recommended by any linked study guide, in Zipf order, with how many guides list it
<br><strong>built """ + datetime.datetime.now().strftime("%Y-%m-%d %H:%M") + """</strong> &middot; if this timestamp is old, the page predates the latest rebuild</p></header>
<main>
<div class="panel"><div class="controls">
  <div><label class=cap>search</label><input id=q placeholder="word…" style="width:11rem"></div>
  <div><label class=cap>min endorsements</label><input type=number id=minc value=1 min=1 max=11 style="width:4.5rem"></div>
  <div><label class=cap>zipf from</label><input type=number id=zlo value=0 step=.1 style="width:4.5rem"></div>
  <div><label class=cap>zipf to</label><input type=number id=zhi value=9 step=.1 style="width:4.5rem"></div>
  <div><label class=cap>ceiling marker</label><input type=number id=ceil value=3.6 step=.05 style="width:4.5rem"></div>
  <div><label class=cap>show</label><select id=filt>
    <option value=all>all</option><option value=surv>only survives our filters</option>
    <option value=cut>only removed by our filters</option>
    <option value=nopool>only absent from the pool</option></select></div>
  <div><label class=cap>sort</label><select id=sort>
    <option value=zipf>zipf, high to low</option><option value=zipfa>zipf, low to high</option>
    <option value=count>endorsements, high to low</option><option value=alpha>alphabetical</option></select></div>
</div><div class="note" id=summary></div></div>
<div class="panel"><table><thead><tr>
  <th>word</th><th>zipf</th><th>band</th><th>endorsed by</th><th>pos</th><th>category</th><th>our filters</th>
</tr></thead><tbody id=rows></tbody></table></div>
</main><script>
const DATA = """ + json.dumps(data, separators=(",", ":")) + """;
const SOURCES = """ + json.dumps(sources) + """;
const $ = id => document.getElementById(id);
function band(z, ceil){
  if (z === null) return "—";
  if (z >= ceil) return "above ceiling";
  return z >= 2.6 ? "Build foundations" : z >= 2.15 ? "Stretch" : z >= 1.0 ? "Challenge me" : "below floor";
}
function render(){
  const q = $("q").value.trim().toLowerCase(), minc = +$("minc").value;
  const zlo = +$("zlo").value, zhi = +$("zhi").value, ceil = +$("ceil").value;
  const filt = $("filt").value, sort = $("sort").value;
  let rows = DATA.filter(r => (!q || r[0].includes(q)) && r[4] >= minc
    && (r[1] === null ? filt === "nopool" || filt === "all"
                      : r[1] >= zlo && r[1] <= zhi));
  if (filt === "surv")   rows = rows.filter(r => r[1] !== null && r[6].length === 0);
  if (filt === "cut")    rows = rows.filter(r => r[1] !== null && r[6].length > 0);
  if (filt === "nopool") rows = rows.filter(r => r[1] === null);
  if (sort === "zipfa") rows = rows.slice().sort((a,b)=>(a[1]??99)-(b[1]??99));
  else if (sort === "count") rows = rows.slice().sort((a,b)=>b[4]-a[4] || (b[1]??-1)-(a[1]??-1));
  else if (sort === "alpha") rows = rows.slice().sort((a,b)=>a[0].localeCompare(b[0]));
  const over = rows.filter(r => r[1] !== null && r[1] >= ceil).length;
  $("summary").innerHTML = `<strong>${rows.length.toLocaleString()}</strong> words &middot; `
    + `${over.toLocaleString()} above the ${ceil} ceiling &middot; `
    + `${rows.filter(r=>r[1]!==null&&r[6].length===0).length.toLocaleString()} survive our filters &middot; `
    + `${rows.filter(r=>r[1]===null).length.toLocaleString()} absent from the pool`;
  $("rows").innerHTML = rows.slice(0, 1200).map(r => {
    const cls = (r[1] !== null && r[1] >= ceil ? "over " : "") + (r[6].length ? "gone" : "");
    return `<tr class="${cls}"><td class="w">${r[0]}</td>
      <td class="z">${r[1] === null ? "—" : r[1].toFixed(2)}</td>
      <td>${band(r[1], ceil)}</td>
      <td><span class="n">${r[4]}</span> <span class="note">${r[5].map(s=>s.replace("GRE: ","").replace("SAT: ","")).join(", ")}</span></td>
      <td>${r[2]}</td><td>${r[3]}</td>
      <td class="note">${r[6].join("; ") || (r[1]===null ? "not in pool" : "—")}</td></tr>`;
  }).join("") + (rows.length > 1200 ? `<tr><td colspan=7 class="note">…${(rows.length-1200).toLocaleString()} more, narrow the filters</td></tr>` : "");
}
document.addEventListener("input", render); render();
</script></body></html>""")
print(f"wrote {html} — {html.stat().st_size/1e6:.2f} MB")
