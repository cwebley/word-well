"""PROTOTYPE (spike #44) — self-contained HTML for tuning band boundaries and intake filters."""
import datetime, hashlib, json, pathlib, sqlite3

# (label, column, default-on)
FLAGS = [("not abstract (concrete noun categories)", "f_abstract=0", True),
         ("transparent (affix strip finds a commoner word)", "f_transparent", True),
         ("derived — grammatical only (naughty → naughtiness)", "f_derived", True),
         ("derived — meaning may shift (industry → industrious)", "f_derived_soft", False),
         ("compound of two common words", "f_compound", True),
         ("blocked hypernym (disease, sport, religion)", "f_blocked", True),
         ("informal / slang / dated (Wiktionary)", "f_informal", True),
         ("participial adjective", "f_participial", True),
         ("British-only form", "f_british", True),
         ("non-preferred spelling variant", "f_variant", True),
         ("field of study (-ology)", "f_ology", True),
         ("roman numeral", "f_roman", True),
         ("no synonyms (singleton synset)", "f_no_synonyms", False)]

con = sqlite3.connect("out/pool.sqlite")
cols = ", ".join(f[1].replace("=0", "") for f in FLAGS)
rows = con.execute(f"""SELECT lemma, display, zipf_summed, pos, lexfile, oewn_senses, scowl_tier,
  CASE WHEN dominant_form<>lemma THEN dominant_form ELSE '' END,
  COALESCE(transparent_root, derived_root, compound_parts, ''), COALESCE(wik_first,''),
  COALESCE(endorsements,0), {cols}
  FROM lemma WHERE zipf_summed IS NOT NULL ORDER BY zipf_summed DESC""").fetchall()

vocab, vidx = [], {}
def lid(lab):
    if lab not in vidx:
        vidx[lab] = len(vocab); vocab.append(lab)
    return vidx[lab]

data = []
for r in rows:
    flags = 0
    for i, (_, col, _d) in enumerate(FLAGS):
        v = r[11 + i]
        bad = (v == 0) if col.endswith("=0") else bool(v)
        if bad: flags |= 1 << i
    # deterministic sort key so the sample does not re-roll when filters change
    h = int(hashlib.md5(r[0].encode()).hexdigest()[:8], 16)
    labs = [lid(x) for x in r[9].split(",") if x]
    endo = r[10]
    data.append([r[1], round(r[2], 2), r[3] or "", (r[4] or "").replace("noun.","n.")
                 .replace("verb.","v.").replace("adj.","a.").replace("adv.","r."),
                 r[5], r[6] or 0, r[7], r[8], flags, h, labs, endo])
print(f"rows {len(data):,}")

html = pathlib.Path("band_browser.html")
html.write_text("""<!doctype html>
<!-- PROTOTYPE ONLY (spike #44): tune band boundaries and intake filters. Throwaway. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WordWell band browser prototype</title><style>
@import url("https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=Literata:opsz,wght@7..72,200..900&display=swap");
:root{--ink:oklch(25% .035 205);--paper:oklch(98% .012 165);--stone:oklch(91% .015 200);
--water:oklch(45% .075 205);--moss:oklch(45% .075 145);--wood:oklch(45% .075 45);
--line:color-mix(in oklab,var(--water),transparent 60%);--sans:"Instrument Sans",sans-serif;--serif:Literata,Georgia,serif}
*{box-sizing:border-box}body{margin:0;background:var(--stone);color:var(--ink);font-family:var(--sans);font-size:14px}
header{background:var(--water);color:var(--paper);padding:1rem 1.4rem}
h1{font-family:var(--serif);font-size:1.4rem;font-weight:520;letter-spacing:-.03em;margin:0}
header p{margin:.28rem 0 0;opacity:.85;font-size:.8rem}
main{padding:1.1rem;max-width:1750px;margin:0 auto}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:.6rem;padding:.9rem 1.1rem;margin-bottom:.9rem}
.top{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:.9rem}
.controls{display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:.5rem}
label.cap{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-bottom:.18rem}
input[type=number]{font:inherit;width:4.8rem;padding:.28rem .4rem;border:1px solid var(--line);border-radius:.3rem;background:var(--paper);color:inherit}
button{font:inherit;padding:.3rem .65rem;border:1px solid var(--line);border-radius:.3rem;background:var(--paper);color:inherit;cursor:pointer}
button:hover{background:var(--stone)}
#hist{display:flex;align-items:flex-end;gap:1px;height:96px;margin:.5rem 0 .15rem}
#hist div{flex:1;background:color-mix(in oklab,var(--ink),transparent 85%)}
#hist div.b0{background:var(--wood)}#hist div.b1{background:var(--moss)}#hist div.b2{background:var(--water)}
.axis{display:flex;justify-content:space-between;font-size:.66rem;opacity:.6}
.flags{display:grid;gap:.18rem;font-size:.81rem}
.flags label{display:flex;align-items:center;gap:.4rem;cursor:pointer}
.flags .n{margin-left:auto;opacity:.6;font-variant-numeric:tabular-nums;font-size:.76rem}
.flags .peek{border:0;background:none;color:var(--water);text-decoration:underline;cursor:pointer;font-size:.74rem;padding:0 0 0 .4rem}
.bands{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.9rem}
.band h2{font-family:var(--serif);font-size:.98rem;margin:0 0 .08rem;font-weight:560}
.band .meta{font-size:.75rem;opacity:.72;margin-bottom:.5rem}
.words{display:flex;flex-wrap:wrap;gap:.26rem}
.w{background:var(--stone);border-radius:.3rem;padding:.16rem .4rem;font-size:.84rem}
.w small{opacity:.5;margin-left:.26rem;font-size:.74em}
.w.gone{background:color-mix(in oklab,var(--wood),transparent 78%);text-decoration:line-through;opacity:.75}
.note{font-size:.74rem;opacity:.72;margin-top:.6rem}
</style></head><body>
<header><h1>Band browser</h1><p>Spike #44 &middot; PROTOTYPE, throwaway &middot; OEWN lemmas deduplicated from wordfreq 3.1.1 (~2021 snapshot), frequency summed over inflected forms &middot; sample is stable: toggling a filter only adds or removes, it never reshuffles
<br><strong>built """ + datetime.datetime.now().strftime("%Y-%m-%d %H:%M") + """</strong> &middot; if this timestamp is old, the page predates the latest rebuild</p></header>
<main>
<div class="panel" id=searchpanel>
  <label class=cap>look up a word</label>
  <input id=q placeholder="defenestrate, ennui, triploid…" autocomplete=off
    style="font:inherit;width:24rem;padding:.4rem .55rem;border:1px solid var(--line);border-radius:.3rem;background:var(--paper);color:inherit">
  <div id=qout style="margin-top:.7rem"></div>
</div>
<div class="top">
<div class="panel">
  <div class="controls">
    <div><label class=cap>floor</label><input type=number id=f0 value=1.0 step=.05></div>
    <div><label class=cap>Challenge / Stretch</label><input type=number id=f1 value=2.15 step=.05></div>
    <div><label class=cap>Stretch / Build</label><input type=number id=f2 value=2.6 step=.05></div>
    <div><label class=cap>ceiling (endorsed)</label><input type=number id=f3 value=3.8 step=.05></div>
    <div><label class=cap>ceiling (unendorsed)</label><input type=number id=f3u value=3.5 step=.05></div>
    <div><label class=cap>sample</label><input type=number id=n value=120 step=20 min=20 max=800></div>
    <div><label class=cap>min endorsements</label><input type=number id=minE value=0 min=0 max=14></div>
    <div><label class=cap>&nbsp;</label><label style="font-size:.8rem;display:flex;gap:.35rem;align-items:center">
      <input type=checkbox id=trustE checked> endorsement beats fuzzy filters</label></div>
    <button id=equal>equal counts</button><button id=reset>reset</button>
  </div>
  <div id=hist></div><div class="axis" id=axis></div>
  <div class="note" id=totals></div>
</div>
<div class="panel"><label class=cap>hide words flagged as</label><div class="flags" id=flags></div>
  <div class="note">counts are within the current bands &middot; filters overlap so they do not sum &middot;
  <strong>show</strong> struck-through previews exactly what that filter is costing you</div></div>
</div>
<div class="panel"><label class=cap>hide by Wiktionary label on the first sense</label>
  <input id=labsearch placeholder="search labels — genetics, physics, music…" style="font:inherit;width:20rem;padding:.3rem .45rem;border:1px solid var(--line);border-radius:.3rem;background:var(--paper);color:inherit;margin-bottom:.5rem">
  <button id=labclear>clear all</button>
  <div id=labs style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.1rem .8rem;max-height:14rem;overflow:auto;font-size:.8rem"></div>
  <div class="note" id=labnote></div></div>
<div class="bands" id=bands></div></main>
<script>
const DATA = """ + json.dumps(data, separators=(",", ":")) + """;
const FLAGS = """ + json.dumps([[f[0], f[2]] for f in FLAGS]) + """;
const VOCAB = """ + json.dumps(vocab, separators=(",", ":")) + """;
const hidden = new Set();
const NAMES = ["Challenge me","Stretch","Build foundations"];
// Flags that are guesses about word-formation rather than facts. An editor who put the
// word on a study guide has better evidence than a string heuristic, so endorsement
// overrides these — but never the factual ones (roman numeral, British spelling, informal).
const FUZZY = FLAGS.map(([n],i) => /transparent|derived|compound/.test(n) ? (1<<i) : 0)
                   .reduce((a,b)=>a|b, 0);
const $ = id => document.getElementById(id);
const BY = new Map(DATA.map(r => [r[0].toLowerCase(), r]));
const bandOf = z => { const c = cuts();
  return z >= c[3] ? "above the ceiling — rejected as already known"
       : z >= c[2] ? "Build foundations" : z >= c[1] ? "Stretch"
       : z >= c[0] ? "Challenge me" : "below the floor"; };
function edits(a, b){                       // bounded Levenshtein, good enough for typos
  if (Math.abs(a.length-b.length) > 2) return 9;
  let prev = [...Array(b.length+1).keys()];
  for (let i=1;i<=a.length;i++){
    const cur=[i];
    for (let j=1;j<=b.length;j++)
      cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
    prev=cur;
  }
  return prev[b.length];
}
function card(r){
  const m = mask();
  const active   = FLAGS.map(([n],i)=> (r[8] & (1<<i)) && (m & (1<<i)) ? n : null).filter(Boolean);
  const dormant  = FLAGS.map(([n],i)=> (r[8] & (1<<i)) && !(m & (1<<i)) ? n : null).filter(Boolean);
  const hiddenBy = r[10].filter(l => hidden.has(l)).map(i=>VOCAB[i]);
  const labs = r[10].map(i=>VOCAB[i]).join(", ");
  return `<div style="background:var(--stone);border-radius:.4rem;padding:.7rem .9rem">
    <div style="font-family:var(--serif);font-size:1.3rem;font-weight:560">${r[0]}
      <span style="font-size:.8rem;font-family:var(--sans);opacity:.7;font-weight:400">
      &nbsp;zipf <strong>${r[1].toFixed(2)}</strong> &middot; ${bandOf(r[1])}</span></div>
    <div style="font-size:.82rem;margin-top:.4rem;line-height:1.7">
      part of speech <strong>${r[2]||"?"}</strong> &middot; category <strong>${r[3]||"?"}</strong> &middot;
      <strong>${r[4]}</strong> sense${r[4]===1?"":"s"} &middot; SCOWL tier <strong>${r[5]||"—"}</strong>
      ${r[6]?`<br>usually met as <strong>${r[6]}</strong>`:""}
      ${r[7]?`<br>derived from / splits as <strong>${r[7]}</strong>`:""}
      ${labs?`<br>Wiktionary first-sense labels: <strong>${labs}</strong>`:""}
      <br>${(active.length || hiddenBy.length)
        ? `<span style="color:var(--wood)">removed right now by: <strong>${
             active.concat(hiddenBy.map(l=>"label “"+l+"”")).join("; ")}</strong></span>`
        : `<span style="color:var(--moss)"><strong>survives your current filters</strong></span>`}
      ${dormant.length ? `<br><span style="opacity:.65">also flagged, but that filter is off:
         ${dormant.join("; ")}</span>` : ""}
    </div></div>`;
}
function search(){
  const q = ($("q").value||"").trim().toLowerCase();
  if (!q){ $("qout").innerHTML=""; return; }
  const exact = BY.get(q);
  let near = [];
  if (!exact){
    near = DATA.filter(r => r[0].toLowerCase().startsWith(q)).slice(0, 12);
    if (near.length < 6) near = near.concat(DATA.filter(r => r[0].toLowerCase().includes(q)).slice(0, 12));
    if (near.length === 0)
      near = DATA.map(r => [edits(q, r[0].toLowerCase()), r]).filter(x => x[0] <= 2)
                 .sort((a,b)=>a[0]-b[0]).slice(0, 10).map(x => x[1]);
  }
  const head = exact ? card(exact)
    : `<div style="font-size:.85rem;opacity:.8;margin-bottom:.5rem">
       <strong>${q}</strong> is not in the pool — it is absent from wordfreq, absent from OEWN,
       or was dropped by the shape filter.${near.length?" Did you mean:":""}</div>`;
  const chips = (exact ? DATA.filter(r=>r[0].toLowerCase()!==q && r[0].toLowerCase().startsWith(q)).slice(0,10) : near)
    .map(r=>`<span class="w" style="cursor:pointer" data-w="${r[0]}">${r[0]}<small>${r[1].toFixed(1)}</small></span>`).join("");
  $("qout").innerHTML = head + (chips?`<div class="words" style="margin-top:.6rem">${chips}</div>`:"");
}
let peek = -1;
$("flags").innerHTML = FLAGS.map(([f,d],i)=>
  `<label><input type=checkbox class=fl data-b="${i}" ${d?"checked":""}> ${f}
   <span class=n id=fc${i}></span><button class=peek data-p="${i}">show</button></label>`).join("");
const cuts = () => [+$("f0").value,+$("f1").value,+$("f2").value,+$("f3").value];
const mask = () => { let m=0; document.querySelectorAll(".fl").forEach(c=>{ if(c.checked) m|=1<<(+c.dataset.b); }); return m; };
function renderLabels(pool){
  const c = new Map();
  pool.forEach(r => r[10].forEach(l => c.set(l, (c.get(l)||0)+1)));
  const q = ($("labsearch").value||"").toLowerCase();
  const list = [...c.entries()].filter(([l])=>!q || VOCAB[l].toLowerCase().includes(q))
                               .sort((a,b)=>b[1]-a[1]).slice(0,140);
  [...hidden].forEach(l => { if(!list.some(([x])=>x===l)) list.unshift([l, 0]); });
  $("labs").innerHTML = list.map(([l,n])=>
    `<label style="display:flex;gap:.35rem;align-items:center;cursor:pointer">
      <input type=checkbox class=lb data-l="${l}" ${hidden.has(l)?"checked":""}>
      <span>${VOCAB[l]}</span><span style="margin-left:auto;opacity:.55">${n.toLocaleString()}</span></label>`).join("");
  $("labnote").textContent = hidden.size
    ? `hiding ${hidden.size} label${hidden.size>1?"s":""}: ` + [...hidden].map(i=>VOCAB[i]).join(", ")
    : "labels come from Wiktionary's first sense only, so a word with a stray technical sense is not punished for it";
}
function render(){
  const c = cuts(), m = mask(), N = +$("n").value;
  // an endorsed word earns headroom above the ceiling; an unendorsed one does not
  const ceilU = +$("f3u").value;
  const inRange = DATA.filter(r => r[1] >= c[0] && r[1] < (r[11] > 0 ? c[3] : Math.min(c[3], ceilU)));
  FLAGS.forEach((_,i)=> $("fc"+i).textContent = inRange.filter(r => r[8] & (1<<i)).length.toLocaleString());
  const kept = inRange.filter(r => !(r[8] & m) && !r[10].some(l => hidden.has(l)));
  renderLabels(inRange.filter(r => !(r[8] & m)));
  const buckets = new Array(50).fill(0);
  kept.forEach(r => { const i = Math.floor((r[1]-1)*10); if(i>=0&&i<50) buckets[i]++; });
  const max = Math.max(...buckets,1);
  $("hist").innerHTML = buckets.map((v,i)=>{ const z=1+i/10; let k="";
    if(z>=c[0]&&z<c[1])k="b0"; else if(z>=c[1]&&z<c[2])k="b1"; else if(z>=c[2]&&z<c[3])k="b2";
    return `<div class="${k}" style="height:${Math.round(v/max*100)}%" title="zipf ${z.toFixed(1)}: ${v}"></div>`;}).join("");
  $("axis").innerHTML=[1,2,3,4,5,6].map(z=>`<span>${z}.0</span>`).join("");
  $("bands").innerHTML=""; const parts=[];
  for(let b=0;b<3;b++){
    const lo=c[b], hi=c[b+1];
    const inBand = kept.filter(r=>r[1]>=lo&&r[1]<hi);
    // stable sample: lowest hash wins, so words hold their place as filters change
    const sample = inBand.slice().sort((x,y)=>x[9]-y[9]).slice(0,N);
    let shown = sample.map(r=>[r,false]);
    if (peek >= 0){
      const lost = inRange.filter(r=>r[1]>=lo&&r[1]<hi && (r[8]&(1<<peek)) && !(r[8]&(m & ~(1<<peek))))
                          .sort((x,y)=>x[9]-y[9]).slice(0,N);
      shown = shown.concat(lost.map(r=>[r,true])).sort((a,b2)=>a[0][9]-b2[0][9]);
    }
    parts.push(`${NAMES[b]} ${inBand.length.toLocaleString()}`);
    const el=document.createElement("div"); el.className="band panel";
    el.innerHTML=`<h2>${NAMES[b]}</h2><div class="meta">zipf ${lo.toFixed(2)}–${hi.toFixed(2)} &middot;
      <strong>${inBand.length.toLocaleString()}</strong> words &middot; ${Math.round(inBand.length/((hi-lo)*10)).toLocaleString()} per 0.1
      &middot; ${inBand.filter(r=>r[11]>0).length.toLocaleString()} endorsed</div>
      <div class="words">${shown.map(([r,gone])=>
        `<span class="w${gone?" gone":""}" title="zipf ${r[1]} · ${r[2]||"?"} · ${r[3]} · ${r[4]} senses · SCOWL ${r[5]||"-"}${r[6]?" · usually seen as "+r[6]:""}${r[7]?" · from "+r[7]:""}${r[10].length?" · labels: "+r[10].map(i=>VOCAB[i]).join(", "):""}">${r[0]}<small>${r[1].toFixed(1)}${r[11] ? " · " + r[11] + "\u2605" : ""}</small></span>`).join("")}</div>`;
    $("bands").appendChild(el);
  }
  $("totals").innerHTML=`<strong>${kept.length.toLocaleString()}</strong> of ${inRange.length.toLocaleString()} in-range lemmas survive &middot; `+parts.join(" &middot; ")
    + (peek>=0 ? ` &middot; <em>previewing what “${FLAGS[peek][0]}” removes — click show again to stop</em>` : "");
}
$("q").addEventListener("input", search);
document.addEventListener("click", e => {
  const w = e.target.closest("[data-w]");
  if (w){ $("q").value = w.dataset.w; search(); }
});
document.addEventListener("change", e => {
  if (e.target.classList.contains("lb")){
    const l = +e.target.dataset.l;
    e.target.checked ? hidden.add(l) : hidden.delete(l);
    render();
  }
});
$("labclear").onclick = () => { hidden.clear(); render(); };
document.addEventListener("click", e => {
  if (e.target.classList.contains("peek")){
    const i = +e.target.dataset.p; peek = (peek === i ? -1 : i); render();
  }
});
$("equal").onclick=()=>{const c=cuts(),m=mask();
  const z=DATA.filter(r=>r[1]>=c[0]&&r[1]<c[3]&&!(r[8]&m)).map(r=>r[1]).sort((a,b)=>a-b);
  if(z.length){$("f1").value=z[(z.length/3)|0].toFixed(2);$("f2").value=z[(2*z.length/3)|0].toFixed(2);}render();};
$("reset").onclick=()=>{[["f0",1.0],["f1",2.15],["f2",2.6],["f3",3.8],["f3u",3.5],["minE",0]].forEach(([k,v])=>$(k).value=v);
  $("trustE").checked=true;
  document.querySelectorAll(".fl").forEach((c,i)=>c.checked=FLAGS[i][1]);hidden.clear();peek=-1;render();};
document.addEventListener("input", e => { if (e.target.id !== "q") render(); });
render();
</script></body></html>""")
print(f"wrote {html} — {html.stat().st_size/1e6:.2f} MB")
