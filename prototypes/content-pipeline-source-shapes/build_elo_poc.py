"""PROTOTYPE (spike #44) — feel the rating dynamics. Endorsed words only, no persistence."""
import json, pathlib, sqlite3, sys

con = sqlite3.connect("out/pool.sqlite")

# Two pools, deliberately comparable. The endorsed one is what fourteen study guides
# vouch for; the unendorsed one is what the mechanical filters produce on their own.
# Endorsed words get the fuzzy-filter override and headroom to 3.8; unendorsed do not.
MODES = {
    "endorsed": dict(
        where="""endorsements > 0 AND zipf_summed < 3.8
                 AND ((f_transparent=0 AND f_derived=0 AND f_compound=0) OR endorsements>0)""",
        file="elo_poc.html", title="Rating dynamics",
        blurb="endorsed words only &mdash; the 14 study-guide lists"),
    "unendorsed": dict(
        where="""endorsements = 0 AND zipf_summed < 3.5
                 AND f_transparent=0 AND f_derived=0 AND f_compound=0""",
        file="elo_poc_unendorsed.html", title="Rating dynamics &mdash; unendorsed pool",
        blurb="<strong>no study guide recommends any of these</strong> &mdash; "
              "purely what the mechanical filters produced"),
}
mode = sys.argv[1] if len(sys.argv) > 1 else "endorsed"
CFG = MODES[mode]

rows = con.execute(f"""SELECT lemma, zipf_summed, endorsements, pos, lexfile
    FROM lemma
    WHERE zipf_summed >= 1.0 AND {CFG['where']}
      AND f_abstract=1 AND f_blocked=0 AND f_informal=0 AND f_roman=0
      AND f_variant=0 AND f_british=0 AND f_ology=0 AND f_participial=0
    ORDER BY zipf_summed""").fetchall()
words = [[w, round(z, 2), e, p or "", (lf or "").replace("noun.", "n.").replace("verb.", "v.")
          .replace("adj.", "a.").replace("adv.", "r.")] for w, z, e, p, lf in rows]
print(f"{mode}: {len(words):,} candidate words")

html = pathlib.Path(CFG["file"])
html.write_text("""<!doctype html>
<!-- PROTOTYPE ONLY (spike #44): learner and word ratings on one scale. Throwaway, no persistence. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + CFG["title"] + """</title><style>
@import url("https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=Literata:opsz,wght@7..72,200..900&display=swap");
:root{--ink:oklch(25% .035 205);--paper:oklch(98% .012 165);--stone:oklch(91% .015 200);
--water:oklch(45% .075 205);--moss:oklch(45% .075 145);--wood:oklch(45% .075 45);
--line:color-mix(in oklab,var(--water),transparent 60%);--sans:"Instrument Sans",sans-serif;--serif:Literata,Georgia,serif}
*{box-sizing:border-box}body{margin:0;background:var(--stone);color:var(--ink);font-family:var(--sans);font-size:14px}
header{background:var(--water);color:var(--paper);padding:1rem 1.4rem}
h1{font-family:var(--serif);font-size:1.4rem;font-weight:520;margin:0;letter-spacing:-.03em}
header p{margin:.3rem 0 0;opacity:.85;font-size:.8rem}
main{padding:1.1rem;max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:1rem}
.panel{background:var(--paper);border:1px solid var(--line);border-radius:.6rem;padding:1rem 1.2rem;margin-bottom:1rem}
label.cap{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;opacity:.7;margin-bottom:.2rem}
button{font:inherit;padding:.45rem .8rem;border:1px solid var(--line);border-radius:.35rem;background:var(--paper);color:inherit;cursor:pointer}
button:hover{background:var(--stone)}
button.persona.on{background:var(--water);color:var(--paper);border-color:var(--water)}
.word{font-family:var(--serif);font-size:2.6rem;font-weight:560;letter-spacing:-.03em;margin:.2rem 0 .1rem}
.meta{font-size:.8rem;opacity:.72;margin-bottom:1rem}
.answers{display:grid;gap:.4rem}
.answers button{text-align:left;padding:.6rem .8rem}
.big{font-family:var(--serif);font-size:2rem;font-weight:560}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.25rem 0;border-bottom:1px solid color-mix(in oklab,var(--line),transparent 60%)}
.n{font-variant-numeric:tabular-nums}
.up{color:var(--wood)}.down{color:var(--moss)}
#spark{width:100%;height:70px}
table{width:100%;border-collapse:collapse;font-size:.8rem}
th{text-align:left;font-size:.65rem;text-transform:uppercase;letter-spacing:.05em;opacity:.65;padding:.25rem .4rem}
td{padding:.22rem .4rem;border-top:1px solid color-mix(in oklab,var(--line),transparent 65%);font-variant-numeric:tabular-nums}
.note{font-size:.74rem;opacity:.72;line-height:1.5}
input[type=range]{width:100%}
</style></head><body>
<header><h1>""" + CFG["title"] + """</h1><p>Spike #44 &middot; PROTOTYPE, nothing persists &middot;
learner and word ratings on one Zipf scale &middot; """ + CFG["blurb"] + """ &middot; """ + str(len(words)) + """ words</p></header>
<main>
<div>
  <div class="panel">
    <label class=cap>pretend you are</label>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.9rem" id=personas></div>
    <div id=card></div>
    <div class="answers" id=answers></div>
  </div>
  <div class="panel">
    <label class=cap>what just happened</label>
    <div id=explain class="note">Answer a word to see the update.</div>
  </div>
  <div class="panel">
    <label class=cap>history</label>
    <table><thead><tr><th>word</th><th>word rating</th><th>you said</th><th>expected</th><th>your rating</th><th>word moved</th></tr></thead>
    <tbody id=log></tbody></table>
  </div>
</div>
<div>
  <div class="panel">
    <label class=cap>your rating</label>
    <div class="big n" id=rating>—</div>
    <div class="note" id=ratingnote></div>
    <svg id=spark viewBox="0 0 300 70" preserveAspectRatio="none"></svg>
  </div>
  <div class="panel">
    <label class=cap>tuning</label>
    <div class="row"><span>learner K <span class=note>how fast you move</span></span><span class="n" id=klv>0.18</span></div>
    <input type=range id=kl min=0.02 max=0.5 step=0.02 value=0.18>
    <div class="row"><span>word K <span class=note>how fast words move</span></span><span class="n" id=kwv>0.05</span></div>
    <input type=range id=kw min=0 max=0.2 step=0.005 value=0.05>
    <div class="row"><span>selection window &plusmn;</span><span class="n" id=winv>0.35</span></div>
    <input type=range id=win min=0.05 max=1.2 step=0.05 value=0.35>
    <div class="row"><span>scale s <span class=note>how sharp the curve is</span></span><span class="n" id=sv>0.45</span></div>
    <input type=range id=s min=0.15 max=1.2 step=0.05 value=0.45>
    <div style="margin-top:.8rem"><button id=reset>reset everything</button></div>
  </div>
  <div class="panel">
    <label class=cap>words whose rating moved most</label>
    <table><thead><tr><th>word</th><th>zipf</th><th>now</th><th>&Delta;</th><th>seen</th></tr></thead><tbody id=moved></tbody></table>
    <div class="note" style="margin-top:.6rem">Word ratings start at Zipf and drift as you answer. A word
    that drifts <em>up</em> is better known than its frequency predicted — the <code>ennui</code> effect.</div>
  </div>
</div>
</main><script>
const WORDS = """ + json.dumps(words, separators=(",", ":")) + """;
const $ = id => document.getElementById(id);
const PERSONAS = [["High schooler",3.2],["Undergraduate",2.9],["Graduate",2.6],["PhD",2.3],["Lexicographer",1.9]];
const ANSWERS = [["Completely new to me",0],["I think I've heard of it",0.34],
                 ["Familiar, but I don't use it",0.67],["I use it all the time",1]];
let rating, hist, seen, state, current, persona = 0;

function init(p){
  persona = p; rating = PERSONAS[p][1]; hist = [rating]; seen = new Set();
  state = new Map(WORDS.map((w,i) => [i, {r: w[1], n: 0}]));
  $("personas").querySelectorAll("button").forEach((b,i)=>b.classList.toggle("on", i===p));
  $("log").innerHTML = ""; $("explain").textContent = "Answer a word to see the update.";
  next(); draw();
}
function next(){
  const win = +$("win").value;
  let pool = WORDS.map((w,i)=>i).filter(i => !seen.has(i) && Math.abs(state.get(i).r - rating) <= win);
  if (!pool.length) pool = WORDS.map((w,i)=>i).filter(i => !seen.has(i))
      .sort((a,b)=>Math.abs(state.get(a).r-rating)-Math.abs(state.get(b).r-rating)).slice(0,40);
  current = pool[Math.floor(Math.random()*pool.length)];
  const w = WORDS[current], st = state.get(current);
  $("card").innerHTML = `<div class="word">${w[0]}</div>
    <div class="meta">word rating <strong class="n">${st.r.toFixed(2)}</strong>
      &middot; zipf ${w[1].toFixed(2)} &middot; ${w[3]} &middot; ${w[4]}
      ${w[2] ? "&middot; endorsed by " + w[2] + " guide" + (w[2]>1?"s":"") + " " : "&middot; <em>no guide recommends this</em> "}&middot; seen ${st.n}&times;</div>`;
  $("answers").innerHTML = ANSWERS.map((a,i)=>`<button data-a="${i}">${a[0]}</button>`).join("");
}
const expected = (wr, lr, s) => 1/(1+Math.exp(-(wr-lr)/s));
function answer(i){
  const s = +$("s").value, KL = +$("kl").value, KW = +$("kw").value;
  const st = state.get(current), w = WORDS[current];
  const e = expected(st.r, rating, s), o = ANSWERS[i][1], surprise = o - e;
  const dL = -KL * surprise, dW = KW * surprise;
  const before = rating, wbefore = st.r;
  rating = Math.max(0.8, Math.min(5, rating + dL));
  st.r = Math.max(0.5, Math.min(6, st.r + dW)); st.n++;
  seen.add(current); hist.push(rating);
  $("explain").innerHTML =
    `Given your rating <strong>${before.toFixed(2)}</strong> and the word's <strong>${wbefore.toFixed(2)}</strong>,
     we expected a <strong>${(e*100).toFixed(0)}%</strong> chance you'd know it. You answered
     <strong>${(o*100).toFixed(0)}%</strong> — ${Math.abs(surprise)<0.12?"about as expected":
       surprise>0?"better than expected, so you move toward rarer words":"worse than expected, so you move toward commoner words"}.
     <br>Your rating ${dL<0?"drops":"rises"} to <strong>${rating.toFixed(3)}</strong> (${dL>0?"+":""}${dL.toFixed(3)});
     the word moves to <strong>${st.r.toFixed(3)}</strong> (${dW>0?"+":""}${dW.toFixed(3)}).
     <br><span class="note">Lower rating = rarer words. A word rating rising means people know it better than its frequency predicted.</span>`;
  $("log").insertAdjacentHTML("afterbegin", `<tr><td>${w[0]}</td><td>${wbefore.toFixed(2)}</td>
    <td>${(o*100).toFixed(0)}%</td><td>${(e*100).toFixed(0)}%</td>
    <td class="${dL<0?"down":"up"}">${before.toFixed(2)} → ${rating.toFixed(2)}</td>
    <td class="${dW>0?"up":"down"}">${dW>0?"+":""}${dW.toFixed(3)}</td></tr>`);
  next(); draw();
}
function draw(){
  $("rating").textContent = rating.toFixed(3);
  const band = rating>=2.6?"Build foundations":rating>=2.15?"Stretch":"Challenge me";
  $("ratingnote").innerHTML = `${band} &middot; ${seen.size} answered &middot; started at ${PERSONAS[persona][1]}`;
  const n = hist.length, mn = Math.min(...hist)-0.05, mx = Math.max(...hist)+0.05;
  const pts = hist.map((v,i)=>`${(i/(Math.max(n-1,1)))*300},${70-((v-mn)/(mx-mn||1))*70}`).join(" ");
  $("spark").innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--water)" stroke-width="2"/>`;
  const moved = [...state.entries()].filter(([,v])=>v.n>0)
    .map(([i,v])=>[WORDS[i][0], WORDS[i][1], v.r, v.r-WORDS[i][1], v.n])
    .sort((a,b)=>Math.abs(b[3])-Math.abs(a[3])).slice(0,12);
  $("moved").innerHTML = moved.map(m=>`<tr><td>${m[0]}</td><td>${m[1].toFixed(2)}</td>
    <td>${m[2].toFixed(2)}</td><td class="${m[3]>0?"up":"down"}">${m[3]>0?"+":""}${m[3].toFixed(3)}</td>
    <td>${m[4]}</td></tr>`).join("") || `<tr><td colspan=5 class="note">nothing yet</td></tr>`;
}
$("personas").innerHTML = PERSONAS.map((p,i)=>`<button class="persona" data-p="${i}">${p[0]} <span class="note">${p[1]}</span></button>`).join("");
document.addEventListener("click", e => {
  const p = e.target.closest("[data-p]"), a = e.target.closest("[data-a]");
  if (p) init(+p.dataset.p);
  if (a) answer(+a.dataset.a);
  if (e.target.id === "reset") init(persona);
});
document.addEventListener("input", () => {
  $("klv").textContent  = mrr($("kl").value);
  $("kwv").textContent  = mrr($("kw").value);
  $("winv").textContent = mrr($("win").value);
  $("sv").textContent   = mrr($("s").value);
});
const mrr = v => (+v).toFixed(3).replace(/0+$/,"").replace(/[.]$/,"");
init(0);
</script></body></html>""")
print(f"wrote {html} — {html.stat().st_size/1e6:.2f} MB")
