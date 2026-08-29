# Building a candidate pool, and narrowing it to words worth teaching

Second half of the spike for [#44](https://github.com/cwebley/word-well/issues/44),
built on top of `content-pipeline-source-shapes.md`. Worked 2026-08-28/29.
Question: where do candidate words come from, and what separates a word worth
delivering from the tens of thousands that are not?

Tags as in the other research docs. **MEASURED** is a number from a script in
`prototypes/content-pipeline-source-shapes/`. **JUDGED** is an editorial call
written out so it can be argued with. **INFERRED** is reasoning from the two.

Still no schema, no migrations, no pipeline code. The pool is scratch SQLite
precisely so it cannot quietly become the production model.

## Decisions

Everything settled so far, with the evidence in the section named. A reader who
needs only the conclusions can stop here.

| Decision | Why | Where |
|---|---|---|
| **wordfreq stays**, its 2021 freeze treated as a feature | the vocabulary LLMs overuse is exactly the target register; a post-2022 corpus would push `delve`, `nuanced`, `pivotal` over the ceiling | [Where the words come from](#where-the-words-come-from) |
| **Bands: floor 1.0, cuts 2.15 / 2.60** | 1.0 is where wordfreq's data stops, not a choice | [Bands](#bands) |
| **Ceiling 3.8 endorsed, 3.5 unendorsed** | the headroom keeps 241 endorsed words (`mitigate`, `paradigm`, `empathy`); unendorsed get the firmer line | [Two tiers](#two-tiers-and-the-ceiling) |
| **Endorsement overrides the fuzzy filters, never the factual ones** | an editor has better evidence than a string heuristic; rescues `distrait`, `rebut`, `injunction`, none fixable mechanically | [The filters](#the-filters) |
| **Ship both tiers in v1**, adjudicating the unendorsed half rather than excluding it | 2,438 endorsed words is only ~6 years of delivery, and endorsement skews academic | [Two tiers](#two-tiers-and-the-ceiling) |
| **"No synonyms" dropped as a gate** | backwards — a word with no synonym is often precise and irreplaceable; it was removing `ethos`, `empathy`, `impunity` | [The filters](#the-filters) |
| **Derivation splits in two**: grammatical removes, meaning-may-shift is a toggle | `naughty`→`naughtiness` teaches nothing; `industry`→`industrious` teaches a great deal | [The filters](#the-filters) |
| **Category membership is judged on ANY sense**, not `synsets()[0]` | `ephemeral`'s first synset is the mayfly; this alone cost 351 endorsed words | [The audit](#editorial-nomination-lists-as-an-audit) |
| **Learner ability and word difficulty are Elo ratings on one shared scale** | one axis, two parameter sets; word ratings seeded from Zipf then learned | [The rating model](#the-rating-model-and-a-poc-for-it) |
| **The family is lesson context, not the unit of delivery** | `industrious` is the candidate, `industry` is material inside its lesson | [The teaching unit](#the-teaching-unit) |
| **Headword is the lemma**, except noun-only entries whose plural carries ≥90% of the mass | "most common form wins" would make `demurred`, `derided` and `castigated` headwords — past-tense dominance is a prose artifact, not evidence | [The teaching unit](#the-teaching-unit) |
| **Bands are a starting point for the rating**, changeable in the UI at any time | under continuous ratings a band is a starting value and a label, not a curriculum | [The rating model](#the-rating-model-and-a-poc-for-it) |
| **Retire a word at ceiling + 0.25**, not at the ceiling | without hysteresis a word sitting at 3.49 is served once and vanishes; band transitions are not events | [The rating model](#the-rating-model-and-a-poc-for-it) |
| **Persist every model output** keyed by input + prompt version | makes "run it on small subsets first" safe: re-runs cost nothing, only a prompt change re-bills | [LLM adjudication](#proposed-llm-adjudication-of-the-fuzzy-filters) |
| **Terms of service: settled** | these are open web lists | — |

The **cost budget** remains open but is no longer treated as a gate — the
approach is small subsets first, with every model output persisted. What is
still genuinely unresolved is listed in [Still open](#still-open).

## The headline

MEASURED. 321,180 wordfreq surface forms reduce to **50,860 lemmas**, of which
**43,654** sit in the 1.0–3.8 delivery range, of which **19,968** survive the
intake filters — Challenge me 7,250, Stretch 3,518, Build foundations 9,200.
Of those, **2,238 carry at least one study-guide endorsement** and 1,156 carry
two or more.

At one delivery a day even the endorsed subset is several years of content, and
the whole pool is decades. Supply was never the constraint.

INFERRED, and this reframed the exercise twice. First: **precision matters
enormously and recall barely matters at all** — discarding a good word costs
nothing when thousands remain, so any filter that is 80% right is worth
applying. Then the study-guide audit reversed it: chasing precision had been
costing words eleven independent editors thought essential, and fixing that
moved endorsed-word recall from 32% to 77% while roughly quadrupling the pool.
The honest position is that **the mechanical filters are no longer the main
instrument** — the endorsement count is.

## Where the words come from

wordfreq 3.1.1, English `large` list — a blend of seven domains (Wikipedia,
OpenSubtitles, NewsCrawl, Google Books Ngrams 2012, OSCAR web text, Twitter,
Reddit) combined by dropping each word's highest and lowest source and averaging
the rest.

**Decision: keep wordfreq, and treat its 2021 freeze as a feature.** The project
is sunset — the maintainer's README says the data "is unlikely to be updated
again," and `SUNSET.md` gives the reason: OSCAR is "full of slop generated by
large language models," Twitter's API closed, and Reddit "sell their archives at
a price that only OpenAI will pay." The example given is that ChatGPT's overuse
of *delve* raised its frequency by an order of magnitude.

MEASURED, and this is why the freeze helps rather than hurts: the vocabulary
LLMs overuse is exactly WordWell's target register. `underscore` 2.97,
`nuanced` 3.26, `meticulous` 3.24, `delve` 3.14, `pivotal` 3.50, `leverage`
3.88, `robust` 3.94, `testament` 4.07 — every one inside the deliverable range,
and the top four close enough to the ceiling that a post-2022 corpus would push
them over it. Words would be rejected as "already known" because a chatbot
overuses them. A pinned, pre-contamination snapshot is the right prior here, and
it also fits #44's existing decision that sources are pinned downloads.

Alternatives considered and not taken: Google Books Ngrams (books only, ends
2019, and its contribution is already inside the blend), COCA (annually updated
and register-split, which is what you would actually want, but commercial),
Sketch Engine (commercial), NGSL (a 2,800-word learner list, wrong shape for
ranking 50,000 lemmas).

**Open**: `zipf_frequency` returns `0.00` both for "absent from the wordlist"
and "vanishingly rare". `doomscroll` is absent because it postdates the corpus;
`vituperate` is absent because it fell below the cutoff. Those are different
dispositions and currently the same number.

## Pool construction

`build_pool.py`, in order. Every step here was wrong at least once; the
[bugs](#bugs-found-and-fixed) section is not padding.

1. **Shape filter.** Alphabetic, lowercase, 3+ characters, not a SCOWL
   abbreviation. Also the multiword guard — the earlier findings measured that
   wordfreq fails *open* on phrases, returning a value derived from the tokens
   (`straight-from-the-shoulder` scores 4.39), so multi-token strings must never
   reach a frequency gate.
2. **Lemma match, case-folded.** `schadenfreude` only resolves because OEWN
   files it as `Schadenfreude`.
3. **Lemmatize the remainder** with `wn.morphy`. One candidate lemma, attribute
   the frequency; several, record as ambiguous and attribute nothing (353
   forms); none, drop.
4. **Sum** each lemma's own frequency with everything that rolled up into it.
   MEASURED: this raises verbs by +0.2 to +0.6 (`qualify` 4.19 → 4.76) and
   leaves adjectives untouched (`salient` 3.12 → 3.12). 504 lemmas exist *only*
   as inflected mass.
5. **Score every filter as a column.** Nothing is deleted at build time, so the
   browser can turn each one on and off against live samples.

MEASURED, and unresolved: **3,877 lemmas have a dominant surface form that is
not the lemma** — `shenanigan` 1.53 against `shenanigans` 3.22, `beleaguer`
1.11 against `beleaguered`. The lemma is the right unit for measuring a
concept's frequency and often the wrong unit for teaching it. See
[the teaching unit](#the-teaching-unit).

## The filters

MEASURED, removals within 1.0–3.8. They overlap heavily, so the column does not
sum.

| Filter | Removes | Default | Catches |
|---|---:|---|---|
| not abstract | 13,571 | on | WordNet's concrete categories — `noun.animal`, `noun.plant`, `noun.substance`, `noun.artifact`. Matched on **any** sense, not the first |
| derived, meaning may shift | 8,405 | **off** | `industry` → `industrious`, plus lexicalised participles (`fleeting`, `exacting`) |
| transparent (affix) | 6,916 | on | strip an affix, find a commoner word — `inoffensive` → `offensive` |
| compound | 4,106 | on | splits into two common words — `threadbare`, `deathblow` |
| derived, grammatical | 1,707 | on | WordNet link via `-ness`/`-ity`/`-ly`/`-ment`/`-y` — `naughtiness`, `zesty` |
| blocked hypernym | 1,470 | on | hypernym chain hits disease, sport, religion, punctuation |
| British-only form | 1,317 | on | SCOWL's British lists without an American twin |
| spelling variant | 668 | on | SCOWL's variant lists, unless also the American form |
| informal register | 459 | on | Wiktionary first-sense label — `antsy`, `spiffy`. **Not** `derogatory`, which describes the referent |
| field of study | 216 | on | `-ology`, `-ography`, `-onomy` |
| roman numeral | 73 | on | regex, not SCOWL's 63-entry list |
| participial adjective | 0 | on | superseded — lexicalised participles now route to the soft derivation flag |
| no synonyms | 13,858 | **off** | singleton synset — **dropped as a gate**, see below |

Every root-frequency guard (`ROOT_KNOWN`, Zipf 3.0) applies to all four
derivation rules — prefix, suffix, WordNet link and participle. Each was added
to one rule and missing from the others at some point, which is the single most
repeated bug in this work.

Plus a **label picker**: every Wiktionary first-sense label present in the pool,
searchable, with live counts. Tick `genetics` and `triploid` goes; tick `physics`
and `polychromatic` goes.

MEASURED, on domain labels as a filter: ticking all 29 domain labels present
removes only about 10% of survivors, because Wiktionary labels are sparse. And
blanket-ticking costs real vocabulary — `legal` holds `abeyance` and
`arraignment`, `military` holds `feint`, `impregnable` and `sortie`, `politics`
holds `brinkmanship` and `realpolitik`, `architecture` holds `vignette` and
`arabesque`. `music`, `surgery`, `botany`, `genetics` and `chemistry` kill
cleanly; the rest need word-by-word judgment.

### The two filters that were wrong

**"No synonyms" was backwards and is now off.** JUDGED: a word with no synonym
is often precise and irreplaceable, which is exactly what makes it worth
teaching. MEASURED, it was removing `ethos`, `empathy`, `impunity`,
`internecine`, `vicarious`, `echelon`, `crass`, `literacy` — 11,789 words to
catch junk that other filters already handle.

**"Derived" conflated two different relationships** and was removing
`industrious`. INFERRED, from the product owner's framing: the family is
*context*, not the unit of delivery. `industrious` is the candidate;
`industry` — at Zipf 5.26, well above the ceiling — is material inside its
lesson. So the question is not "is this linked to a common relative" but "is
this word's meaning **predictable** from a relative the learner knows."
`naughty` → `naughtiness` is predictable. `industry` → `industrious` is not:
nothing about *industry* tells you it means diligent.

The split is by suffix class, which is a weak proxy but the best mechanical one
found. Two better ideas were tested and rejected:

- **Gloss test** — WordNet writes grammatical derivations compositionally, naming
  the root: `wistfully` = "in a *wistful* manner", `saintliness` = "the quality
  of resembling a *saint*". MEASURED: precise when it fires, poor recall —
  `naughtiness` = "an attribute of mischievous children" never says *naughty*.
- **Exempting drift-capable suffixes wholesale** — MEASURED: recovers 242 words
  through the other filters, and they are overwhelmingly good (`beneficent`,
  `contemptuous`, `tempestuous`, `vertiginous`, `derisive`, `evocative`,
  `epistolary`, `farcical`, `revelatory`, `captious`). The technical junk that
  worried me (`sulfurous`, `cuprous`, `leguminous`) is already caught by the
  abstract filter, because those are `adj.pert` rather than `adj.all`.

INFERRED: no mechanical signal separates `industrious` (keep) from `sulfurous`
(drop). "Does knowing X tell you what Y means?" is a one-line semantic judgment
over roughly 2,000 words. **This is the second place the spike has measured a
genuine need for a model** — the first was the synonym filter, where mechanical
rules caught 14 of 17 junk members and missed exactly the three that were common
words with the wrong meaning. Both are small, well-scoped, and on the intake
side rather than the generation side. Relevant to the cost budget question.

## Editorial nomination lists as an audit

Fourteen study-guide lists were ingested — eight GRE guides aggregated in one
sheet, two ACT tiers from Test Ninjas, College Transitions' 174 ACT words,
Acely and Mometrix for SAT, and vocabulary.com's tone list. **3,060 unique
endorsed words**, with an agreement gradient from 1 to 11 lists.

Their value turned out to be less as a source of words than as an **externally
labelled test set** — the eval set that had been deferred as too much work to
build by hand. It immediately found two systematic errors that were invisible
from inside:

**The ceiling was too low.** MEASURED: 1,178 endorsed words sat above the 3.05
ceiling, including `eschew`, `engender`, `parochial`, `somber`, `convoluted`,
`meager` and `fervor`. Raised to **3.8**, which keeps `refute` (7 guides),
`bolster` (7), `empirical` (6), `emulate` (6) and `maverick` (6) while still
cutting `advocate` 4.52, `aesthetic` 4.02, `undermine` 4.00 and `pedestrian`
3.90.

**The abstract filter was judging words by `synsets()[0]`** — an arbitrary first
sense. `ephemeral`'s first WordNet synset is the mayfly (`noun.animal`),
`bolster`'s is a cushion (`noun.artifact`), `mercurial`'s is "relating to
mercury" (`adj.pert`). Matching against *any* sense recovered **351 endorsed
words**. This was the filter violating #44's own rule that eligibility is judged
on a word's most useful meaning rather than its headword.

Category membership was then re-derived from endorsement density rather than by
eye, which added `verb.change` (9.6%), `verb.possession` (13.6%),
`verb.contact` (8.3%), `noun.event` (6.6%), `noun.person` (3.8%),
`noun.group` (5.5%) and `adj.pert` (4.1%) — `noun.act`, already in the set, sits
at 2.8%.

MEASURED: endorsed-word recall went from 32% to **77%** across these changes,
while survivors grew from 5,428 to about 20,000. Precision fell as recall rose,
and the endorsement count is now doing more filtering work than the mechanical
rules: 1,156 words carry two or more endorsements.

**Decision: endorsement overrides the fuzzy filters.** A word an editor put on a
study guide is not removed by a string heuristic about its morphology. This
applies only to the guessing rules — transparency, compound splitting,
derivation — never to the factual ones (roman numeral, British spelling,
informal register, semantic category).

INFERRED: endorsement should be a **ranking prior, not a hard gate**. A gate
would cap the product at ~2,000 words and make it permanently dependent on other
people's lists, which is the dependency #44 flags as needing a per-source
terms-of-service decision.

## The rating model, and a POC for it

**Decision: learner ability and word difficulty are Elo ratings on one shared
scale.** Not two axes — one axis with two populations of parameters, which is
item response theory with Elo as its online approximation. A learner has a
rating, every word has a rating seeded from its Zipf, and the update size scales
with how surprising the outcome was.

Two prototypes let you feel it:
`prototypes/rating-dynamics-prototype.html` (2,439 endorsed words) and
`prototypes/rating-dynamics-unendorsed-prototype.html` (16,044 words no study
guide recommends). Same machinery, deliberately comparable pools. Pick a persona
— High schooler 3.2 through Lexicographer 1.9 — answer on the four-level
familiarity scale already designed in `familiarity-gate-prototype.html`, and
watch both ratings move, with the expected probability and both deltas shown for
every answer.

The asymmetry the model needs falls out of the maths rather than being coded in.
MEASURED, from a learner at 3.2 with s=0.45 and K=0.18:

| Outcome | Expected | Move |
|---|---|---|
| knows a word at 3.4 | 61% | 3.200 → 3.130, small |
| misses a word at 2.6 | 24% | 3.130 → 3.172, **small** — missing a rare word is unsurprising |
| knows a word at 2.4 | 15% | 3.172 → 3.020, **large** — that is informative |

Four design points, all INFERRED:

1. **Wildly asymmetric learning rates.** A word accumulates thousands of
   observations, a learner one a day. Both POCs ship with word K at 0.05 so
   drift is visible in a single sitting; production wants it far lower.
2. **Carry confidence, not just a rating** — Glicko rather than plain Elo, so a
   word seen five times and one seen five thousand times are not trusted alike.
3. **Anchor something**, or the whole scale drifts without anything meaningful
   changing. Slow word movement is the natural anchor.
4. **Weight practice above self-report.** The schema already separates them:
   `learner_choices` kind `familiarity` (before the lesson) versus
   `learner_evidence` kind `practice` with a `correct` boolean.

Two consequences worth recording.

**The band boundaries are largely cosmetic under this model.** If a learner
carries a continuous rating, `Build foundations` / `Stretch` / `Challenge me` are
a starting value and a label. Much of the boundary-tuning in this document picks
a starting point, not a curriculum.

**Learned word ratings answer a question frequency cannot.** Zipf offers only
~50 distinct values per 0.5-wide window, with roughly 200 words sharing each, so
it cannot order words finely anywhere in the range. More importantly, a word
whose learned rating drifts above its Zipf prior is better known than its
frequency predicted — the `ennui` effect, measured at last. That divergence
would place the "already known" ceiling empirically instead of by argument.

The catch: it needs learners. Until then every word's rating is its Zipf prior
and the system behaves exactly like static banding, so it cannot help choose the
first few thousand words. INFERRED: this narrows the intake question usefully —
*how hard* a word is gets measured later, so intake only has to decide whether a
word is **worth teaching at all**, which is the appropriateness-and-interest
judgment that needs a model.

## Bands

**Decision: floor 1.0, cuts at 2.15 and 2.60, ceiling 3.05.**

The ceiling came down from 4.5 on the product owner's call. MEASURED
consequence, stated at the time and accepted: `salient` (3.12), `rectify`
(3.25), `sporadic` (3.29), `preclude` (3.33), `mitigate` (3.71) and `sanction`
(4.07) now sit above the ceiling — which is #44's "rare but genuinely useful,
must pass" row. Defensible, since most degree-educated adults do know `mitigate`
and `sanction`, but it reverses a stated assumption of the parent ticket.

The floor is 1.0 because that is where the data stops. wordfreq's `large` list
covers "words that appear at least once per 100 million words," which *is* Zipf
1.0 by definition. MEASURED: the lowest value present is 1.010, with 4,013 words
piled at that single value — the shape of a truncated list. In reading terms, a
Zipf 1.0 word appears about once in a thousand novels.

MEASURED, on lowering it from 1.5: adds 1,042 survivors at roughly a 40% hit
rate against 60–70% higher up. Worth it for `loquacity`, `malinger`, `raillery`,
`prurience`, `benison`; the cost is more sifting.

Two cautions about the axis itself:

**Band counts are width artifacts, not signal.** MEASURED: at the original
2.6/3.4 cuts, Challenge me and Stretch had near-identical density (1,636 vs
1,576 words per 0.1 Zipf); Challenge me looked bigger only because it spanned
1.1 Zipf against 0.8. The one real cliff is between Stretch and Build
foundations, where density halves.

**Frequency is coarse everywhere.** MEASURED: each 0.5 Zipf window holds only
~50 distinct values, with ties of ~200 words. Words cannot be ordered finely by
frequency at any point in the range.

**And frequency is not familiarity.** `ennui` sits at 2.41 — Challenge me — but
reads as a high-school vocabulary word, because familiarity comes from word
lists rather than usage. `retry` at 2.76 reads common to a developer for the
same reason. INFERRED: the axis will systematically misplace the whole class of
words taught more often than used, and only learner `familiarity` data can
correct it. The capture already exists (`learner_choices`, kind `familiarity`,
recorded before the lesson is read).

### Two tiers, and the ceiling

**Decision: endorsed words are allowed up to Zipf 3.8; unendorsed stop at 3.5.**
MEASURED: the headroom keeps 241 endorsed words between 3.5 and 3.8 —
`mitigate`, `paradigm`, `empathy`, `volatile`, `imminent`, `paradox` — while
holding unendorsed words to the firmer line. 18,463 survivors, 2,438 endorsed.

**Decision: endorsement overrides the fuzzy filters but never the factual ones.**
An editor who put a word on a study guide has better evidence than a string
heuristic about its morphology. This is what rescues `distrait`, `rebut`,
`injunction` and `pastoral`, none of which could be fixed mechanically. It costs
almost nothing: 19,955 survivors without the override, 20,161 with, because it
only fires where a word is both endorsed and removed *solely* by a guess.

**Decision: ship both tiers in v1**, with LLM adjudication filtering the
unendorsed half rather than excluding it. The terms-of-service question is
settled — these are open web lists.

## The teaching unit

Three findings turned out to be one question: `shenanigan` 1.53 against
`shenanigans` 3.22; `rebut` condemned by `rebuttal`; `vituperate` absent while
`vituperation` and `vituperative` are present. What *is* a headword?

**Settled: several candidates sharing one context object.** Family membership is
a lesson-content relationship, not a candidacy one. `industrious` is the
candidate; `industry`, at Zipf 5.26 and well above any ceiling, is material
inside its lesson — etymology and related forms — never a delivered word. This
is cleaner than merging a family into one candidate and picking a
representative, and it relocates rather than contradicts the derivation filter.

**Settled: the headword is the lemma, with one narrow exception.**

MEASURED: 3,416 in-band lemmas have a dominant surface form that is not the
lemma, and every one is unambiguous — anything that is itself an OEWN lemma
keeps its own frequency and never rolls up, so a rolled-up form is by
construction not a rival entry. No judge is needed to identify the pairs.

But "most common form wins" is the wrong rule. MEASURED, what those dominant
forms actually are:

| Dominant form is a… | Count |
|---|---:|
| plural / 3rd person | 1,813 |
| past tense / participle | 1,024 |
| present participle | 354 |
| other | 225 |

Applying it naively yields `demurred`, `derided`, `castigated`, `repudiated`,
`admonished` and `exacerbated` as headwords. Past-tense dominance is an artifact
of prose being written in the past tense; for a verb the lemma is simply right.

The real signal is narrow: **nouns whose singular barely exists.** MEASURED: 202
lemmas never appear in the singular at all, and 227 are noun-only with the
plural carrying ≥90% of the mass. `shenanigan` sits at 98%, which is why it
reads wrong — it is the exception, not the pattern.

**Known gap in the implementation.** `auspice` and `dreg` record
`dominant_form = auspice` / `dreg`, because no plural was ever rolled up for
them — so the ≥90% rule misses two textbook plural-only nouns. The signal is
right; the detection is incomplete. Any word whose plural is a separate OEWN
lemma will slip through the same way.

**Not built.** Two implementation traps are already measured for the family
side:

1. **Never build families by transitive closure.** Directly-linked pairs are
   safe — WordNet joins no classic false friend directly. Transitively,
   `industrious`/`industrial`, `economic`/`economical`, `historic`/`historical`
   and `sensible`/`sensitive` all merge through their shared root, and
   `cow`/`coward`/`cowardly`/`cower` becomes one family via the verb sense of
   *cow*.
2. **Families must be built over all of OEWN, not over pool members.** MEASURED:
   built over the pool, the `vituperate` family comes back **empty**, because
   `vituperation` and `vituperative` connect only *through* `vituperate`, which
   the frequency gate excluded. The case this is wanted for fails unless
   families are formed first and pool frequency computed from them afterwards.

## Proposed: LLM adjudication of the fuzzy filters

Not built. Recorded because the spike arrived at it from four directions.

The mechanical rules fail in one specific way: **they invent morphology that
does not exist.** `distrait` ← `dis`+`trait`, `injunction` ← `in`+`junction`,
`pastoral` ← `past`+`oral`, `fleeting` ← `flee`+`ting`, `preachy` ← `achy`,
`rebut` ← `but`, `minatory` ← `mina`+`tory`, `deism` ← `ism`. Three such cases
were fixed by hand in one sitting and a fourth appeared immediately. The
failures are not a category that another rule can capture; they are a long tail
of string coincidences.

The proposal is to keep flagging mechanically and let a judge adjudicate the
flagged set, writing its verdict as another column so the mechanical pool stays
intact and comparable.

MEASURED, the workload — words flagged by a fuzzy rule but clean on every
factual one:

| Rule | Words | Endorsed |
|---|---:|---:|
| affix strip | 4,722 | 130 |
| compound split | 2,090 | 62 |
| derivation, grammatical | 1,619 | 32 |
| derivation, may shift | 7,587 | 399 |
| union | **12,781** | **623** |

One short judgment each, once per pool build rather than per delivery, and the
623 endorsed words in the set are a built-in accuracy check.

INFERRED: this is the same job as three others the spike identified — synonym
junk ("is this member the same meaning as the headword"), derivation drift
("does knowing the root tell you this word"), and bogus morphology ("is this
analysis even true"). All three reduce to *does this mechanical claim about the
word hold up*, so one judge with a well-scoped prompt plausibly covers all
three. Content appropriateness (`spaz`, `carjack`) is a genuinely separate
fourth. Relevant to the cost budget: one job, not four.

## Still open

Split by whether it blocks other work.

### Blocking

- **Plural-only detection is incomplete.** The ≥90% rule misses `auspice` and
  `dreg`, whose plurals were never rolled up because they are separate OEWN
  lemmas. Roughly 227 words are caught correctly; an unknown number are missed
  the same way. See [the teaching unit](#the-teaching-unit).
- **Derivational families are designed but not built**, including the two traps
  measured there.

### Measurement gaps

- Content appropriateness. `spaz`, `carjack` — neither technical, derived,
  informal-labelled, nor concrete. No lookup reaches this; the fourth
  model-shaped job.
- Language and ethnonym names — `caddoan`, `chahta`, `lusatian`, `pashtu` sit in
  `noun.communication` and pass the abstract filter.
- `rebut`, `distrait`, `preachy` — bogus morphology, only rescued when a guide
  happens to endorse the word. The adjudication pass is the real fix.
- The exact ceiling. Bounded by argument, not measured. Learned word ratings
  would place it empirically — see [the rating model](#the-rating-model-and-a-poc-for-it).
- 26% of OEWN lemmas are absent from wordfreq entirely, `vituperate` among them.
  The recoverable seam is mostly `oscheocele` and `pseudocyesis`, so an
  editorial list is the answer rather than a lower floor.

### Carried over from #38, still unanswered

- **Field-level disposition** — should a failing *optional* field (etymology,
  expanded section) be dropped so the rest of the record can publish, instead of
  quarantining the whole record?
- **Dependency edges** — #44 informs #38 and #33, but no native GitHub
  dependency edges were ever set.

## Bugs found and fixed

Recorded because most were found by looking at real words, not by reasoning.

| Bug | Symptom | Cause |
|---|---|---|
| Acronym case-folding | `car`, `news`, `nice`, `idea` missing from the pool — 1,208 words | SCOWL's abbreviation lists hold uppercase acronyms (`CAR`, `NEWS`); `.lower()` folded them onto ordinary words |
| Initialisms admitted | `ThM`, `MALS`, `SGML`, `AAVE`, `LLD` surviving | the case-*insensitive* lemma match added to recover `Schadenfreude`. Fixed by rejecting display forms with capitals after the first letter |
| Roman numerals | `xlviii` surviving | SCOWL's list has only 63 entries. A regex catches 65 |
| Prefix root too short | `retry` surviving | the prefix rule required a 4-character root; `try` is 3 |
| Undirected derivation links | `rebut` killed by `rebuttal`, `atone` by `atonement`, `acquaint` by `acquaintance`, `perjure` by `perjury` | WordNet derivation links have no direction, so a common *derivative* condemned its own rarer source. Fixed by requiring the root be shorter |
| Prefix stripping on an obscure root | `defenestration` killed by `fenestration` (1.85 vs 1.96) | the transparency rule assumed a commoner root is a *known* root. The `f_derived` guard existed; `f_transparent` never got it |
| Register filter over-firing | `exonerate`, `rectify`, `sporadic`, `diffident`, `venal`, `tawdry`, `effete` flagged informal | `archaic`/`obsolete`/`dated` were in the reject set, and the earlier findings had already measured 26 such labels sitting on minor senses of current words |
| Sample reshuffling | toggling any filter appeared to reveal or hide words | the browser re-rolled its random sample on every change, so apparent effects were unrelated to the filter touched. Fixed with a stable hash ordering plus a diff view |
| Lemma-side filters | `kg` → `kgs`, single letters `u`, `v`, `d` in the pool | shape filters ran on the surface form but not on the resulting lemma |

INFERRED, the pattern: blind affix-stripping invents morphology that does not
exist — `preachy` ← `achy`, `rebut` ← `but`, `deism` ← `ism`, `dewar` ← `war`.
WordNet's real derivation links should be preferred wherever they exist, with
affix-stripping as the fallback. `rebut` remains lost to this.

## Running it

```sh
python3 -m venv venv && ./venv/bin/pip install wordfreq wn requests
export WN_DATA_DIR="$PWD/data/wn"
./venv/bin/python -c "import wn; wn.download('oewn:2025')"
curl -sSL -o data/scowl.tar.gz https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz
tar xzf data/scowl.tar.gz -C data
./venv/bin/python build_pool.py       # ~60s  -> out/pool.sqlite
./venv/bin/python fetch_labels.py     # ~3m   -> Wiktionary labels for survivors only
./venv/bin/python build_browser.py    #       -> band_browser.html
```

`prototypes/band-browser-prototype.html` is the result: draggable band
boundaries, a histogram shaded by band, a stable per-band sample that only adds
and removes as filters change, a **show** link per filter that strikes through
what it is costing you, the label picker, and a word lookup that reports any
word's Zipf, band, category, labels and exactly which filters are removing it.

`pool.sqlite` keeps every filter as a column, so nothing above is baked in.
