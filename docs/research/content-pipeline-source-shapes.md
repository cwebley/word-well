# Content pipeline: what the sources actually look like

Spike for [#44](https://github.com/cwebley/word-well/issues/44). Measured
2026-08-28. Question: do the four assumptions the candidate-intake design in
#38 and #33 rests on survive contact with real records?

Every claim is tagged. **MEASURED** means it comes from a number produced by a
script in `prototypes/content-pipeline-source-shapes/`, against the retained
snapshots described below. **JUDGED** means I made an editorial call on real
records and the call is written out so it can be disagreed with. **INFERRED**
means I reasoned from the two and could be wrong.

Nothing here is schema. No types, no migrations, no pipeline code.

## Verdicts

| # | Assumption under test | Verdict |
|---|---|---|
| 1 | Source meanings are finer-grained than published meanings | **Confirmed.** 4:1 for ordinary words, 12:1 with the big polysemes. Every non-trivial word needed a many-to-one merge. |
| 2 | Wiktionary usage labels can replace Google Books Ngrams for archaic detection | **Confirmed with a hole.** Labels attach per sense, which Ngrams can never do — but 3 of 8 senses on the archaic test words carry no currency label at all, `perchance` among them. |
| 3 | OEWN synsets carry enough unusable members to justify an LLM synonym filter | **Confirmed.** 38% judged junk, 41% mechanically suspect. Far past the 5% threshold where you would skip the model. |
| 4 | Editorial nomination lists overlap enough for cross-source agreement to be a calibration signal | **Not measured.** Only one cleanly-licensed editorial list was reachable; the rest need the per-source terms-of-service decision that #44 reserves for a human. Resolution rate for that one list is measured below. |

The spike also turned up three things nobody was looking for. They are in
[Unbidden findings](#unbidden-findings) and two of them change the design more
than the assumptions did.

## What was pulled

MEASURED. 33 words, the fixed list in #44. All five sources responded; every
record is retained under the release identifier below.

| Source | Release | Retrieved | Integrity |
|---|---|---|---|
| Open English WordNet | `oewn:2025`, CC BY 4.0 | 2026-08-28, via `wn` 1.1.1 | package-managed index |
| English Wiktionary | per-page revisions, CC BY-SA | 2026-08-28, MediaWiki API | revid + revision timestamp per page, in `wiktionary-manifest.json` |
| CMUdict | `master` | 2026-08-28 | sha256 `81917843…891c3d22` |
| SCOWL | `scowl-2020.12.07` | 2026-08-28 | sha256 `5587667c…3fb859cc` |
| wordfreq | 3.1.1, `large` English list | 2026-08-28 | pinned package version |

Coverage gaps, MEASURED: OEWN misses `whilom`, `whinge`, `doomscroll` (3/33).
CMUdict misses `pulchritude`, `whilom`, `schlep`, `whinge`, `doomscroll`,
`ad hominem` (6/33, 82% coverage). SCOWL has no entry for `doomscroll` or
`ad hominem`. Wiktionary had all 33.

The `kaikki.org` path scheme recorded as broken in the #44 comment was not
retried. It was not needed: the MediaWiki API covers 33 words in two requests.

## Assumption 1 — meaning granularity and merge rate

MEASURED. Across the 33 words, OEWN offers 171 senses and Wiktionary 272 sense
lines. Median OEWN senses per word is 2; the mean is 5.2, dragged there by
`run` (57) and `line` (36). Wiktionary carries more senses than OEWN for 22 of
33 words.

JUDGED. Merge worksheet for the five granularity words. "Source meanings" counts
OEWN senses plus Wiktionary sense lines; "published" is what I would keep for a
learner.

| Word | Source meanings | Published | Ratio | The merge that mattered |
|---|---|---|---|---|
| `candid` | 8 | 2 | 4:1 | OEWN `a#1` "directness in manner or speech" and `a#3` "openly straightforward and direct without reserve" are one learner meaning. Two source meanings, one published meaning. |
| `sanction` | 13 | 4 | 3.3:1 | Three approval nouns collapse to one; two permission verbs collapse to one. The punitive noun and verb stay separate — **they do not merge**, as predicted. |
| `qualify` | 18 | 3 | 6:1 | "meet requirements" / "pronounce fit" / "make fit or prepared" collapse to two, split by argument structure rather than by meaning. "make more specific" and "add a modifier to a constituent" collapse to one. |
| `run` | 127 | ~6 | 21:1 | Not enumerated. The ratio is the finding. |
| `line` | 93 | ~6 | 15:1 | Not enumerated. |

Excluding `run` and `line`, the three judged words give 39 source meanings to 9
published, **4.3:1**. Including them, 259 to 21, **12.3:1**.

**Confirmed, and stronger than the design assumed.** Every one of the three
words I worked through in full needed at least one many-to-one merge, so
one-to-one provenance would have been wrong on all of them. `PublishedMeaning.provenance.definition`
being a single `SourceEvidence` (gap 4 in the #44 comment) is not an edge case
to fix later; it fails on the first ordinary word.

INFERRED. Provenance is many-to-one *across sources*, not just within one. The
published "official approval" meaning of `sanction` draws on three OEWN senses
and one Wiktionary sense line. A provenance record that can cite several source
meanings but only from one source would still fail here.

## Assumption 2 — can Wiktionary labels replace Ngrams

MEASURED, label density across the 33 words:

- 272 sense lines, 157 carrying at least one label — **58%**.
- 28 of 33 words carry a label on at least one sense — **85%**.
- 242 label occurrences on those sense lines, of which 89 topical (`computing`,
  `heraldry`, `juggling`), 58 grammatical (`transitive`, `in the plural`), 43
  currency (`archaic`, `obsolete`, `dated`, `historical`, `rare`, `now`), 29
  regional, 23 register (`informal`, `literary`, `humorous`).
- Only 8 further label occurrences sit on headword template lines, 250 in all.

That last number settles the attachment question: **labels are per source
meaning.** MEASURED, and the consequence is concrete: 26 `obsolete` / `archaic`
/ `dated` / `historical` labels sit on senses of the 18 words in the list that
are plainly current — `nice` has five, `line` six, `run` three. A
headword-level archaic signal, which is the only kind Ngrams can produce, would
either miss all 26 or condemn `nice` and `run` along with them. Labels are the
better-shaped instrument, not merely the cheaper one.

MEASURED, the hole. Currency labels cover only 39 of 272 senses (14%), across
17 of 33 words, and the misses are exactly where it hurts:

| Word | Labels on its senses | Caught by a currency filter? |
|---|---|---|
| `betwixt` | `literary`, `archaic` | yes |
| `whilom` | `archaic`, `literary` on 2 senses; `obsolete` on 2; **nothing on 2** | partly |
| `perchance` | `literary`, `humorous` | **no** |

`perchance` is the whole point of that row of the word list and a filter keyed
on `{archaic, obsolete, dated, historical}` lets it straight through. Adding
`literary` catches it, and MEASURED, `literary` appears on only four senses in
the whole sample — all three archaic words and nothing else, so it is a cheap
addition with no observed false positive here. But `whilom`'s two conjunction
senses carry no label of any kind, so even the widened filter admits senses of a
word that has been dead for centuries.

**Confirmed for the purpose Ngrams was in the design for.** Ngrams cannot do
sense-level currency at all, so it was never able to do this job; drop it.
INFERRED: label absence is not evidence of currency, so the archaic gate should
be phrased as "admit only senses affirmatively current" rather than "reject
senses affirmatively archaic", with the unlabelled remainder going to a judge.
That is a different gate shape than the design currently implies.

Frequency cannot patch the hole. MEASURED: `perchance` sits at Zipf 2.51 and
`betwixt` at 2.39, against `lugubrious` 2.02 and `defenestration` 1.85 — the
archaic words are *more* common than rare words that should pass. There is no
frequency threshold that separates them.

## Assumption 3 — synonym junk rate

MEASURED, across all 171 synsets touched by the word list:

- 69 synsets (40%) contain only the headword. They offer no synonyms at all.
- 264 non-headword members are offered as synonyms.
- 74 (28%) are multiword or hyphenated; 34 (13%) are single words below Zipf
  2.5. **41% mechanically suspect.**

JUDGED, on a defined sample — the first synset of each of the 18 words that has
a co-member, 45 members in total. 17 are unusable for a learner: **38% junk.**
The junk falls in three kinds.

- Dead or vanishing forms: `indorsement` (Zipf 0.0), `meliorate` (1.1),
  `schlepper` / `shlepper` / `shlep` (all 0.0), `free-spoken`.
- Phrases nobody says: `straight-from-the-shoulder`, `tabular array`,
  `of import`, `water parting`.
- **Common words that are the wrong meaning**: `silent` for `tacit`,
  `spectacular` for `salient`, `foreclose` for `preclude`.

MEASURED, what a mechanical prefilter (drop multiword, drop Zipf < 2.5) would
do to that sample: it catches 14 of the 17 junk members, over-rejects about 6 of
the 28 good ones (`plainspoken`, `sagacious`, `by chance`, `melting pot`,
`measure up`, `imprimatur`), and misses exactly the three in the third kind.

**Confirmed.** The rate is nowhere near the 5% where you would skip the model.
INFERRED, and this is the useful part: the model is not needed for *volume*, it
is needed for *one specific failure* — a frequent, well-formed word that means
something else. Mechanics handle the other two kinds at zero cost. A judge
scoped to "is this member the same meaning as the headword in this sense" over
the ~59% that survive mechanical filtering is a much smaller bill than filtering
everything with a model.

## Assumption 4 — nomination overlap

**Not measured.** Cross-source agreement needs two independent editorial lists.
Wiktionary's Word of the Day is cleanly licensed and was pulled. The commercial
word-of-the-day feeds were not fetched: #44 reserves the terms-of-service
question for a human, per source, and that decision has not been made. A
frequency-derived academic list (NAWL, AWL) was considered as a stand-in and
rejected — it is not editorial, so a low overlap against it would measure the
mismatch in list-making method, not editorial disagreement. This criterion stays
open.

What was measured is the other half of that criterion, resolution rate, on the
one list in hand. MEASURED, Wiktionary Word of the Day, 976 day pages for
2024–2026, 975 unique headwords:

| Filter | Survivors | Share |
|---|---|---|
| raw headwords | 975 | — |
| minus multiword and hyphenated (288) | 687 | 30% lost |
| minus capitalised / proper-noun shaped (71, of which 33 not already dropped) | 654 | a further 3% |
| resolving to an OEWN lemma (whole list) | 502 | **51%** |
| resolving to an OEWN lemma (plain headwords only) | 420 of 654 | 64% |
| below the proposed Zipf ceiling, non-zero, and resolving | 384 | **39% of raw** |

MEASURED: 166 of the 654 plain headwords (25%) are absent from wordfreq
entirely, returning Zipf 0.0.

A naive intake would have swallowed `Boaty McBoatface`, `Chinese New Year`,
`Electric Boogaloo`, `F in the chat` and `Blursday`. INFERRED: an editorial WOTD
list is a nomination *feed*, not a candidate list — it needs the same intake
gauntlet as any other source, and it loses 61% of its volume to it. And the 384
that survive still include `aardwolf`, `anoxia`, `albumen`, `affiant` and
`aldermanic`, which pass every mechanical gate and are still bad learner
vocabulary. The mechanical gates set up the judgement; they do not replace it.

(One parser artifact, MEASURED: `101` survives every filter. Intake needs an
alphabetic check that nobody thought to write down.)

## Pronunciation: CMUdict coverage and the ARPAbet transform

MEASURED. CMUdict covers 27 of 33 words (82%). The six misses are
`pulchritude`, `whilom`, `schlep`, `whinge`, `doomscroll`, `ad hominem` — a
British word, a Yiddish word, a neologism, a Latin phrase, and two rare words.
Six words carry multiple pronunciations with nothing to disambiguate them.

**The ARPAbet-to-IPA transform is not mechanical.** MEASURED, running a
straight phone-by-phone substitution over all 33 retained pronunciations:

- The primary stress mark lands mid-syllable in **32 of 33** cases. IPA puts `ˈ`
  at the syllable onset; ARPAbet puts the stress digit on the vowel. Getting
  from one to the other needs syllable boundaries, **and CMUdict does not carry
  them**. `K AE1 N D AH0 D` yields `/kˈændʌd/` where the answer is `/ˈkæn.dɪd/`.
- `AH0` is schwa and `AH1` is STRUT, the same symbol for two different IPA
  vowels. A stress-conditioned rule fixes it, but the naive table does not have
  one. Same for `ER0` / `ER1`.
- `Kafkaesque` is transcribed `K AA1 F K AH0 EH1 S K` — two primary stresses,
  which is not valid IPA. Something has to demote one.
- `nice` has two pronunciations, `N AY1 S` and `N IY1 S`. The second is the
  French city. CMUdict merged a proper noun into the headword and gives you no
  way to know.

INFERRED, and this is a change of direction: **Wiktionary is the better
pronunciation source.** MEASURED, it carries IPA for 32 of 33 words (97%),
already syllabified and already stressed — `/ˈkæn.dɪd/`, `/ˌpɜː.spɪˈkeɪ.ʃəs/`,
`/əsˈtjuːt/` — and it covers five of the six words CMUdict misses. Only
`ad hominem` has no IPA anywhere. What Wiktionary does not do is pick an accent
for you: `candid` comes back with a General American form and a raised-`æ` form,
`perspicacious` with RP and GA. Choosing which to publish, and labelling it, is
a product decision, not a scrape. CMUdict's remaining value is as a
machine-readable cross-check and as a source of stress and syllable-count
features, not as the published pronunciation.

## Etymology

JUDGED. Raw wikitext is template soup — `{{inh|en|enm|nyce}}`,
`{{der|en|la|nescius||ignorant, not knowing}}` — and reconstructing prose from
it means reimplementing MediaWiki templates. MEASURED: the rendered route
(`action=parse&prop=text&section=N`, then strip tags) returns clean prose in one
request:

> From Middle French *sincere*, from Latin *sincerus* ("genuine"), from
> Proto-Indo-European *\*sem-* ("together") … Not from *sine* ("without") +
> *cera* ("wax"), which is a folk etymology.

**Keep the field**, and source it rendered rather than raw. Two reasons beyond
readability. The `sincere` entry explicitly refutes the folk etymology, which is
the version a model is most likely to produce unprompted — the grounded source
is doing real work here, not decoration. And `quarantine`'s forty days is
exactly the kind of hook the product wants.

MEASURED, a structural surprise: etymology attaches to a numbered **Etymology
section**, which groups several part-of-speech blocks under it. `nice` has two —
the adjective, and the Unix `nice` command. So etymology sits at a third level
of granularity, between headword and sense, and linking it to a published
meaning means knowing which etymology group the source meaning came from. The
parser in this spike flattened that; a real extractor cannot.

## Frequency bands and the ceiling

MEASURED, Zipf for the whole list, against the intent groups the word list
encodes:

| Group | Zipf range |
|---|---|
| already known — reject at the ceiling | `table` 5.05, `important` 5.44 |
| rare but useful — must pass | `tacit` 2.94 … `mitigate` 3.54 |
| performative — reject at Build foundations | `pulchritude` 1.36 … `lugubrious` 2.02 |
| archaic — hard reject | `whilom` 1.34 … `perchance` 2.51 |
| register / regional | `schlep` 1.95 … `ameliorate` 2.56 |

Performative (1.36–2.02) and must-pass (2.94–3.54) separate cleanly with no
overlap. INFERRED boundaries, which put every word of the list where #44 says it
belongs:

| Band | Zipf | The list's members |
|---|---|---|
| Build foundations | 3.4 – 4.5 | `qualify`, `sincere`, `quarantine`, `mitigate`, `watershed`, `candid`, `sanction` |
| Stretch | 2.6 – 3.4 | `byzantine`, `crucible`, `salient`, `astute`, `preclude`, `tacit` |
| Challenge me | below 2.6 | 14 words |
| reject, already known | 4.5 and above | `run`, `line`, `important`, `nice`, `table`, `angry` |

**The ceiling is the top edge of the band axis**, which answers half of the open
question in the handoff — it is the same axis, not a second one. But the
evidence only bounds it: `sincere` at 3.84 must pass and `table` at 5.05 must
reject, so the true line is somewhere in between and this list has nothing in
4.2–5.0 to place it more precisely. 4.5 is a guess inside a measured interval,
not a measurement. A larger sample would pin it.

MEASURED, a caveat on every Zipf number above. wordfreq counts surface forms,
not lemmas: `zipf_frequency("mitigate")` does not include `mitigated`,
`mitigating` or `mitigates`. Summing a lemma's inflected forms raises it by
+0.08 to +0.57 — `qualify` 4.19 to 4.76, `preclude` 3.03 to 3.33, `ameliorate`
2.56 to 2.79, which crosses a band boundary. `salient` does not move at all.
The bias is systematic and uneven: verbs are understated most, adjectives with
no productive inflection not at all. INFERRED: whichever convention production
picks, it has to be the same one the boundaries were fitted on. These
boundaries were fitted on single surface forms, so switching to lemma-summed
frequency means moving them up by roughly 0.2–0.3, and more for verbs.

**Performativeness being band-relative survives**, since it correlates with the
axis. **Archaic and register do not.** MEASURED: the Challenge me band holds
`perspicacious` (performative), `whilom` (archaic), `schlep` (informal),
`whinge` (British) and `doomscroll` (too new to have a frequency at all) side by
side. Frequency orders difficulty; it cannot tell those five kinds of hard
apart. Every one of them needs its own gate, and the bands cannot carry the
rejection logic.

## Unbidden findings

### OEWN cannot be the meaning inventory

MEASURED, and this is the largest result in the spike. For three words of 33,
OEWN does not contain the meaning that decides the product question.

- **`sanction`** — OEWN 2025 has seven senses, all of them approval or
  authorisation. The punitive sense is **absent entirely**, noun and verb. The
  contronym that the word list was built around cannot be seen from OEWN. It is
  in Wiktionary, labelled `mostly in the plural`.
- **`defenestration`** — OEWN has one sense, the window. The figurative "removal
  of a person from an organization", which is the entire reason the word is
  eligible, is Wiktionary-only.
- **`crucible`** — OEWN has one sense, the vessel. "A very difficult and trying
  experience" is Wiktionary-only.

`watershed` and `byzantine`, by contrast, have their figurative senses in OEWN.

INFERRED: the "judge a word on its most useful meaning" rule and an
OEWN-as-inventory design are incompatible. Wiktionary has to be a meaning
source, not a metadata sidecar — which also means the merge stage has to align
senses *across* two sources with different granularity, a harder problem than
merging within one.

Nor can the `figurative` label find these cheaply. MEASURED: only 10 senses in
the whole sample carry `figurative` or `figuratively`, across 5 words, and
`defenestration`'s figurative sense is not one of them — it is labelled
`Britain`.

### wordfreq silently invents frequencies for phrases

MEASURED. `zipf_frequency` on a multi-token string returns a value derived from
the tokens, not the phrase:

| String | Zipf returned | Its tokens |
|---|---|---|
| `straight-from-the-shoulder` | 4.39 | straight 5.04, from 6.63, the 7.73, shoulder 4.50 |
| `heart-to-heart` | 5.01 | heart 5.31, to 7.43 |
| `free-spoken` | 4.42 | free 5.63, spoken 4.45 |
| `line of work` | 5.36 | — |

The result tracks the rarest token, so a phrase built from common words scores
as a common word. `straight-from-the-shoulder` is not a Zipf 4.4 expression.

INFERRED: any frequency gate — the ceiling, the band assignment, the synonym
filter — is invalid on multi-token input and fails *open*, admitting rare
phrases as common ones. Multi-token strings need rejecting or routing elsewhere
before the gate, not after. This is also why the 28% multiword share of synset
members could not be triaged by frequency.

### The intake gauntlet is mostly not a model

INFERRED, from the three measurements taken together. Mechanical rules —
multiword rejection, Zipf banding, OEWN resolution, currency labels — take the
WOTD feed from 975 to 384, and take the judged synonym sample from 38% junk to
12% (3 junk members left in 25 survivors), at no per-item cost. What they cannot do is decide whether a well-formed frequent word
means the right thing: `silent` for `tacit`, `spectacular` for `salient`, or
`aardwolf` as learner vocabulary. That residue is where the judging ladder
earns its cost, and it is a much smaller share of volume than a model-first
design would assume. Which is the same shape as lesson 4's rule in the
reference course: code-based scorers first, judges reserved for what code cannot
decide.

## What this changes

Design consequences, all INFERRED, none of them implemented here.

1. Provenance must be many-to-one **and cross-source**. Confirmed on the first
   three words tried, not an edge case.
2. Google Books Ngrams drops out of the design. Wiktionary sense labels do the
   job it was there for, better.
3. The archaic gate should admit affirmatively-current senses rather than reject
   affirmatively-archaic ones, with unlabelled senses going to a judge.
4. Wiktionary becomes a meaning source alongside OEWN, not a metadata sidecar.
   The merge stage has to align senses across two inventories.
5. Wiktionary replaces CMUdict as the published pronunciation. An accent has to
   be chosen and labelled.
6. Etymology stays, sourced from rendered HTML, attached to an etymology group
   rather than a sense.
7. Multi-token strings must be rejected before any frequency gate, which
   currently fails open on them.
8. Nomination feeds need the full intake gauntlet; they are not candidate lists.

## What is still unmeasured

- Cross-source editorial overlap (assumption 4). Blocked on the per-source
  terms-of-service decision, which #44 leaves to a human.
- The frequency ceiling's exact value. Bounded to (3.84, 5.05] by this list;
  needs a sample with words in that gap.
- Whether the merge ratios hold beyond 33 deliberately-chosen words. This list
  was picked to be hard, so 4.3:1 is probably an upper bound for ordinary
  vocabulary.
- Judge design, rubric design, confidence derivation, publication thresholds —
  the rest of #38, untouched.

## Reproducing

Scripts are in `prototypes/content-pipeline-source-shapes/`, with the extracted
JSON they produced. They are throwaway: no error handling, no tests, and they
write to a scratch directory rather than any database. Run order is
`fetch_wiktionary.py`, `extract.py`, `parse_wiktionary.py`, `arpabet.py`,
`fetch_wotd.py`, `measure_nominations.py`, in a virtualenv with
`wordfreq wn requests`. The raw snapshots (107 MB of OEWN index, the CMUdict and
SCOWL downloads, 384 KB of wikitext) were not committed.
