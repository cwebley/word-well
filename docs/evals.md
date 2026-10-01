# Pipeline evals

How WordWell measures each content-pipeline stage, so a model, prompt or
configuration change can be re-run against the same cases and compared.
Approved 2026-09-24. The usefulness eval is built (see below); the other stages
are still design only.

```text
intake (rules) -> appropriateness (Jev) -> usefulness (Jev) -> planner (Luna) -> writer (Luna) -> owner review
     |                  |                        |                   |                |
 unit tests      private eval set          owner eval set      contract checks + owner reading
```

The first version has no grouping stage
([decision](https://github.com/cwebley/word-well/issues/1#issuecomment-5823937201)).

## Rules for every stage

- An eval set is frozen and versioned. Adding cases, changing inputs or
  correcting a label creates a new version, and the current configuration is
  re-run on it before any comparison.
- Expected outcomes never enter a model input.
- Held-out cases are never used for tuning. A held-out case that gets inspected
  and tuned against moves to the development set.
- A stage eval calls the same stage code as production, with frozen inputs.
- Promotion is always the owner's recorded decision. A pass bar is the minimum
  evidence before that decision. Nothing switches automatically.
- Private cases (appropriateness) never enter Git in plaintext, public issues or
  hosted traces. Only aggregate numbers go to Braintrust.
- This file carries aggregate numbers only, never label contents.

## Intake

Deterministic rules: frequency ceiling (Zipf above 3.7), prohibited source
labels, Roman numerals, proper nouns. Covered by unit tests, which must all
pass. No model, so no eval.

## Appropriateness

Design fixed by [#2](https://github.com/cwebley/word-well/issues/2#issuecomment-5693877045),
with the model moved to Jev ([amendment](https://github.com/cwebley/word-well/issues/2#issuecomment-5823943376)).

- **Cases.** Owner-authored `clear`, `sensitive` or `blocked` findings with a
  short reason, written before seeing model answers. None exist yet; authoring
  is [#12](https://github.com/cwebley/word-well/issues/12), blocked by private
  storage in [#8](https://github.com/cwebley/word-well/issues/8).
- **Scoring.** Three trials per case. Reports per-trial correctness, cases
  correct on all three trials, and cases whose verdict varied.
- **Where it runs.** Privately. One aggregate summary row goes to Braintrust.

## Usefulness

Full design on [#11](https://github.com/cwebley/word-well/issues/11#issuecomment-5823939569).

- **What is tested.** The whole gate behind an adapter: headword and recorded
  parts of speech in, advance or exclude out. Raw Jev answers are stored so
  cutoff sweeps need no new calls.
- **Trials.** Production averages three Jev trials, and the eval scores that
  averaged verdict. Words whose verdict flips between trials are reported.
- **Development set.** All owner labels, frozen as
  `evals/datasets/usefulness-dev-v1.json`: 136 words, 132 firm and 4 soft. It is
  committed with headword, OEWN parts of speech, decision and tags only. Soft
  labels count as correct either way and are reported separately.
- **Held-out set.** Kept private, outside the repo. 60 words drawn at random from the pool after intake and the
  appropriateness rules, labelled blind before any model output exists, topped
  up until 15 are keeps.
- **Tags.** Difficulty `clear` or `hard`; category `too_familiar`,
  `too_specific`, `keep`, `intake_should_catch`, `soft`. Scores are reported per
  tag and overall.
- **Metrics.** Precision on keeps is primary: a wrong admit is the worse
  mistake. Recall on keeps is the floor. Wrong admits are counted by type, and
  every mistake is listed by name.

| Situation | Pass bar |
| --- | --- |
| First time in production | Held-out precision ≥ 0.80 and recall ≥ 0.50, plus owner review of each mistake by name |
| Replacing the current configuration | Same dataset version; precision no lower; recall down by at most one keep (about 0.07); same review |

The owner may override a floor with a written reason. With about 15 held-out
keeps, the numbers are coarse.

### Running it

```sh
# Replay saved answers, no cost
npm run eval:usefulness -- --dataset evals/datasets/usefulness-dev-v1.json \
  --combiner config/usefulness-combiner-<id>.json --replay-from <answers.json>

# Live Jev; OPENROUTER_API_KEY in the environment. With --replay-from, only
# requests never answered are sent.
npm run eval:usefulness -- ... --jev live --max-requests 450
```

Experiments and every Jev attempt are written privately under
`~/src/wordwell-private/runs/usefulness/`. A bad reply for one word marks that
word incomplete; HTTP errors, lost connections, the request cap, an unpinned
model version, or a third bad reply stop the run. The combiner is fitted by
`tools/usefulness-fit/fit.py` and committed under `config/` as numbers only.

### Results

| Date | Dataset | Combiner | Jev | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| 2026-09-28 | usefulness-dev-v1 (`d712efb9`), 132 scored of 136 | `27dab670`, fitted on the same set | v1 route, fresh, 411 requests, $0.039 | 0.810 | 0.839 |
| 2026-09-28 | usefulness-dev-v1 | `152642aa`, refitted on v1-route answers | replay of the run above | 0.814 | 0.857 |
| 2026-09-28 | usefulness-dev-v2 (`29766667`), one label corrected | `152642aa` | replay | 0.831 | 0.860 |
| 2026-09-28 | usefulness-dev-v2 | `d7022878`, refitted on dev-v2 | replay | 0.845 | 0.860 |

**Held-out, first run (2026-09-29).** `usefulness-heldout-v1`: 60 words drawn at
random from the prototype pool (seed 20260928), appropriateness pre-screened,
labelled blind: 15 keeps, 45 excludes. Live v1 route, 180 requests, $0.017.

| Combiner | Precision | Recall | AUC |
| --- | --- | --- | --- |
| `152642aa` | 0.500 | 0.267 | 0.742 |
| `d7022878` | 0.500 | 0.267 | 0.744 |

Both fail the first-time bar (precision ≥ 0.80, recall ≥ 0.50). For comparison,
`d7022878` has a cross-validated development AUC of 0.895. Keeps are 25% of the
random draw and 43% of the development set.

**Development v3 (2026-09-29).** `usefulness-dev-v3` (`8ab6d761`): dev-v2 plus
the 60 words of held-out v1, which moved to development once inspected, with a
relabel under a new owner rule: a too-specific word is kept if an ordinary adult
could use it figuratively in a clear comparison. 196 words, 79 keeps.
Cross-validated on identical folds, v1-route answers:

| Questions | Precision | Recall | AUC | On the 60 random-pool words (P / R / AUC) |
| --- | --- | --- | --- | --- |
| Nine gate questions | 0.760 | 0.722 | 0.859 | 0.600 / 0.353 / 0.802 |
| Nine + `figurative_transfer` (candidate) | 0.776 | 0.747 | 0.865 | 0.667 / 0.471 / 0.817 |

A new held-out set is needed before any pass-bar judgment.

**Held-out v2 baseline (2026-09-29).** `usefulness-heldout-v2`: 60 more random
pool words, labelled blind, 20 keeps. Gate: ten questions (figurative transfer
added), combiner `3e5c41bb` fitted on `usefulness-dev-v4` (256 words, 120 of
them random-pool), cutoff 0.60 chosen from development data before this run.
Live v1 route, 180 requests, $0.020.

| Precision | Recall | Wrong admits | Wrong excludes |
| --- | --- | --- | --- |
| 0.571 | 0.400 | 6 (3 too familiar, 3 too specific) | 12 |

Rescored by replay (same Jev answers) with combiner `17332331` (dev-v5, 0.60):
precision 0.583, recall 0.350, AUC 0.760, against a cross-validated development
estimate of 0.850 / 0.515 on random-pool words.

After a blind owner review of its 20 keeps under the familiar line (13 moved to
too familiar), `usefulness-heldout-v2.1` has 7 keeps, below the 15 the design
requires. Replay with `17332331`: precision 0.167, recall 0.286, AUC 0.701.

Fails the first-time bar. This is the fixed yardstick for question changes
under #11; it is read as aggregates only and not rerun after every change.

**Frequency as a gate input, measured and not adopted (2026-09-29).** Adding
direct wordfreq Zipf as an eleventh input on `usefulness-dev-v6` (cutoff 0.60,
same folds) gave no consistent gain on random-pool words: +0.06 recall with
all development words, −0.05 precision and −0.03 recall when training only on
intake-eligible words. Dropping two words alone moved the baseline by about
0.05, so these differences are within fold noise. The gate keeps its approved
headword-and-POS input; frequency stays an intake ceiling only.

**Top-ranked bar, first measurement (2026-10-01).** Bar amended on
[#11](https://github.com/cwebley/word-well/issues/11#issuecomment-5925213214).
1,000 fresh random pool words (seed 20260928, after the words already used),
appropriateness pre-screened, scored by combiner `78e8b008` (dev-v7). The
owner labelled the gate's top 40 plus 40 random from the rest, shuffled, blind.
6,147 requests, $0.40.

| Gate's top | Keeps | Precision | Cutoff | Projected admitted pool |
| --- | --- | --- | --- | --- |
| 10 | 6 | 0.60 | 0.909 | about 420 |
| 20 | 13 | 0.65 | 0.857 | about 840 |
| 40 | 22 | 0.55 | 0.709 | about 1,680 |

Random 40 from the rest: 2 keeps (5%), so about 48 keeps among the other 960 and
an estimated recall of about 0.31 for the top 40. The top is enriched about
eleven-fold over the rest, but fails the 0.80 bar. Of the 18 wrong admits in the
top 40, 11 are too specific and 7 too familiar.

**Candidate question `general_reading`, measured and not adopted (2026-10-01).**
"Where would an educated adult ordinarily encounter this word?" (general vs
specialist or scholarly writing, 0–3; `evals/candidates/general-reading-v1.json`).
On dev-v7 cross-validation it left AUC and top-ranked keeps unchanged (weight
rank 15 of 17). Jev rates owner keeps such as pedagogy as scholarly as the
too-specific words it was meant to catch. 768 requests, $0.016.

Development numbers are optimistic because each combiner is fitted on the words
it is scored on. Cross-validated precision and recall: `27dab670` 0.714 and
0.714 (lab answers), `152642aa` 0.783 and 0.839, `d7022878` 0.770 and 0.825.
No combiner is promoted. Only held-out numbers count toward a pass bar.

## Planner and writer

Design fixed by [#10](https://github.com/cwebley/word-well/issues/10#issuecomment-5733461061)
and [#6](https://github.com/cwebley/word-well/issues/6#issuecomment-5823943547).

- **Cases.** A few fixed test words. Prototype candidates (`emulate`, `offset`,
  `cleave`, `precipitate`, `plastic`) need owner review before use. Writer cases
  use a fixed, owner-approved plan and never rerun the planner.
- **Checks.** Deterministic contract checks run on all three trials of every
  case and must pass.
- **Reading.** When a change is being compared, the owner reads all three
  trials of each case and scores each 1 to 5 in Braintrust: 5 publish as is,
  3 needs edits, 1 wrong. The score is for comparing versions. There is no
  threshold and no LLM judge.
- **Promotion.** Requires no unresolved factual, grounding or meaning-coverage
  failures in what the owner read.

The one-time approval of about ten launch lessons is separate from these evals.
It is a publication decision, not a measurement.

## Open

- Usefulness gate contract: questions, combiner, obviousness cutoff (#11).
- Jev on the v1 route: parity re-run and account-level zero data retention.
- Braintrust `trialCount` behavior, to confirm against its docs.
