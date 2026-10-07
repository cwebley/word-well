# Pipeline evals

How WordWell measures each content-pipeline stage, so a model, prompt or
configuration change can be re-run against the same cases and compared.
Approved 2026-09-24. The usefulness eval, private appropriateness authoring and
private appropriateness execution are built. The other stage evals remain unbuilt.

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

The [approved authoring resolution](https://github.com/cwebley/word-well/issues/12#issuecomment-5959625563)
amends the original policy to headword-only Jev with two findings, `clear` and
`blocked`. Blocked includes plausible prohibited connotations in the agreed
categories, and any slur sense blocks a headword even when its main sense is
harmless. Neutral medical or anatomical subject matter alone remains allowed.

- The model receives the exact frozen headword and the fixed policy question.
  Parts of speech, definitions, source labels, and owner expectations/reasons do
  not enter the request. Dictionary labels still drive deterministic intake and
  help select private candidates.
- The initial set targets 40 firm owner-approved cases, 20 development and 20
  held-out, roughly balanced clear/blocked. Combine label-selected Wiktionary
  candidates, owner nominations, and legitimate clear controls. Keep close
  variants on the same side. Uncertain labels remain exploration cases.
- The local browser form accepts a word, expected finding, and optional short
  reason before model-answer inspection. The owner [made reasons optional](https://github.com/cwebley/word-well/issues/14#issuecomment-5984954383)
  for saving, approval, and freezing. It saves encrypted drafts outside the
  checkout and freezes approved cases into immutable encrypted artifacts. Owner-authored
  versions v1 to v7 are frozen. See [local setup and walkthrough](private-authoring.md).
- Each request asks the main `appropriateness` choice question plus a narrow
  `slur_sense` yes/no question. A trial rejects when blocked probability reaches
  0.50 or slur probability reaches 0.40. Production averages each question over
  three fresh trials, unrounded, before applying its threshold.
- The default configuration is `v4` (owner decision, [#15](https://github.com/cwebley/word-well/issues/15#issuecomment-5989103199)).
  It excludes terms for genitals and sexual acts from the anatomical exemption.
  Earlier configurations (`v1` to `v3`) and tried variants stay runnable by name
  on the same frozen inputs.
- **Pass rule: no wrong accepts** ([owner decision](https://github.com/cwebley/word-well/issues/15#issuecomment-5989305376)).
  A case passes when all three trials are valid and no trial and no average
  wrongly accepts a blocked word. Wrong rejects are counted and shown, but
  tolerated. Invalid, missing or unresolved trials block a pass.
- Report wrong accepts/rejects, cases correct on all three trials, and disposition
  instability. Promotion requires the owner's explicit decision.
- Authoring, freezing, inspection, finalization, and export make zero model calls.
  Execution and detailed review stay private. Braintrust receives one finalized
  aggregate summary row per experiment.

Private authoring and durable private execution are implemented. See
[private authoring](private-authoring.md) and [private execution](private-appropriateness.md).
Provider prerequisites were verified on 2026-10-04: zero data retention, logging
off, Broadcast empty, and published pricing.

| Run | Configuration | Cases passing | Wrong accepts (avg) | Wrong rejects (avg) |
| --- | --- | --- | --- | --- |
| Dataset v7, held-out (21 cases) | `v4` | 21 of 21 | 0 | 1 |

These are aggregate counts only. Per-case results stay in the local report.

## Usefulness

Full design on [#11](https://github.com/cwebley/word-well/issues/11#issuecomment-5823939569).

- **What is tested.** The whole gate behind an adapter: headword and recorded
  parts of speech in, advance or exclude out. Raw Jev answers are stored so
  cutoff sweeps need no new calls.
- **Trials.** Production averages three Jev trials, and the eval scores that
  averaged verdict. Words whose verdict flips between trials are reported.
- **Development set.** Development labels, currently frozen as
  `evals/datasets/usefulness-dev-v9.json`: 344 words, 340 firm and 4 soft. It is
  committed with headword, OEWN parts of speech, decision and tags only. Soft
  labels count as correct either way and are reported separately.
- **Held-out set.** Kept private, outside the repo. Under the amended design,
  1,000 fresh random pool words pass intake and appropriateness screening. The
  owner labels the gate's top 40 plus 40 random words from the rest, shuffled
  blind. Ranking changes may require blind follow-up labels. Owner corrections
  after a by-name review create a separate reviewed version.
- **Tags.** Difficulty `clear` or `hard`; category `too_familiar`,
  `too_specific`, `keep`, `intake_should_catch`, `soft`. Scores are reported per
  tag and overall.
- **Metrics.** Precision on top-ranked keeps is primary: a wrong admit is the
  worse mistake. Projected admitted-pool size is the floor. Recall remains a
  diagnostic. Wrong admits are counted by type, and every mistake is listed by
  name.

| Situation | Pass bar |
| --- | --- |
| First time in production | Top-ranked precision ≥ 0.80 at a projected admitted pool of at least 1,000 words, plus owner review of each mistake by name |
| Replacing the current configuration | Same measurement design and dataset version; top-ranked precision no lower; projected admitted pool still at least 1,000 words; same review |

The owner may override a floor with a written reason. The top-ranked bar
[replaced the original precision/recall bar](https://github.com/cwebley/word-well/issues/11#issuecomment-5925213214)
on 2026-10-01. These estimates come from small labelled samples.

### Promoted configuration

The owner [approved production use](https://github.com/cwebley/word-well/issues/11#issuecomment-5940925373)
of the `e9d29c21` weights with a **0.58** cutoff. `PRODUCTION_COMBINER` in
`pipeline/stages/usefulness-production.ts` loads
`config/usefulness-combiner-effc8eb93ba0.json`. The gate advances a word when
the score from its averaged three Jev trials is at least 0.58.

`effc8eb93ba0` identifies this threshold selection separately from the original
`e9d29c21` fit at 0.50. Its ID is the SHA-256 of the canonical, key-sorted
`threshold_selection` object in the artifact. The weights are identical, but
the stage config fingerprints differ so results at the two cutoffs stay distinct.

The accepted reviewed sample gives 22 keeps among 26 admits, precision 0.846,
and a projected pool of about 1,090 words. The projection uses the intake frame
before appropriateness screening. A fresh blind check is deferred. The
[durable coordinator and evaluation](production-usefulness.md) use the shared
executor with this configuration by default.

### Running it

```sh
# Replay saved answers with the promoted configuration, no cost
npm run eval:usefulness -- --dataset evals/datasets/usefulness-dev-v1.json \
  --replay-from <answers.json>

# For an experiment, explicitly select another frozen combiner
npm run eval:usefulness -- --dataset <dataset.json> \
  --combiner config/usefulness-combiner-<id>.json --replay-from <answers.json>

# New durable evaluation. Explicit budget and OPENROUTER_API_KEY required.
npm run eval:usefulness -- --dataset <dataset.json> --jev live --max-cost-usd <cap>
npm run eval:usefulness -- --resume <experiment-id>
npm run eval:usefulness -- --inspect <experiment-id>
```

Historical replay experiments and answers remain under
`~/src/wordwell-private/runs/usefulness/`. New paid evaluations save encrypted
attempts and replies in PostgreSQL through the shared executor. Invalid trials
remain recorded and make that case incomplete. Transport/accounting failures
stop further dispatch; resume preserves completed trials. The combiner is fitted by
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

**Top-ranked bar, second measurement (2026-10-01).** Combiner `c35a2cbf`,
fitted on dev-v8, which adds the dev-v7 gate's top 40 (plus 20 random) from a
second fresh 1,000-word sample, labelled blind. Same held-out 1,000-word sample
as above, rescored by replay; the 14 words new to its top 40 were labelled blind
with 14 random fillers.

| Gate's top | Keeps | Precision | Cutoff | Projected admitted pool |
| --- | --- | --- | --- | --- |
| 10 | 8 | 0.80 | 0.752 | about 420 |
| 20 | 17 | 0.85 | 0.656 | about 840 |
| 30 | 20 | 0.67 | 0.531 | about 1,260 |
| 40 | 23 | 0.57 | 0.481 | about 1,680 |

Wrong admits in the top 40: 15 too familiar, 2 too specific (was 7 and 11).
Close to the bar but not over it: 0.80 holds only up to a pool of about 840.
The second sample cost 6,171 requests, $0.40.

**Top-ranked bar, third measurement (2026-10-01).**
Combiner `e9d29c21`, fitted on dev-v9. The owner labelled the eight previously
unlabelled words in `c35a2cbf`'s top 40 from the second sample, mixed with 20
random unlabelled words from the rest. Existing labels cover the other 32.
The new batch has 5 keeps, 16 too-familiar excludes and 7 too-specific excludes.
Dev-v9 has 344 words, including 81 keeps and 4 soft labels; 340 firm cases train
the combiner. The previous fit reproduced exactly before refitting with the
same settings. Development cross-validated precision is 0.757, recall 0.691.

The same held-out 1,000-word sample was rescored by replay. No held-out words
entered training. A two-word blind follow-up covered the one unlabelled word
in the top 40 and one random filler. Both were excludes. All top-40 labels
are now complete; the follow-up did not change scores or ranking.

| Gate's top | Keeps | Precision | Cutoff | Projected admitted pool |
| --- | --- | --- | --- | --- |
| 10 | 8 | 0.800 | 0.755 | about 419 |
| 20 | 17 | 0.850 | 0.673 | about 838 |
| 22 | 19 | 0.864 | 0.644 | about 922 |
| 23 | 19 | 0.826 | 0.630 | about 964 |
| 24 | 19 | 0.792 | 0.597 | about 1,006 |
| 30 | 21 | 0.700 | 0.519 | about 1,258 |
| 40 | 22 | 0.550 | 0.480 | about 1,677 |

Among the measured ranks, the largest top-ranked set at or above 0.80 is the
top 23, short of the 1,000-word pool target. The top 24 still have 19 keeps.
Wrong admits in the top 40 are 15 too familiar and 3 too specific. Top-40
precision fell from 23/40 for `c35a2cbf` to 22/40; top-24 precision is unchanged
at 19/24. This round does not meet the promotion bar. By-name reports for both
combiners are ready privately and await owner review. No new model requests
or cost.

Pool projections use the same calculation as earlier measurements: the rank
fraction of the 1,000-word sample times the 41,920-word intake frame. That
frame is before appropriateness screening, so these are estimates, not counts
of a fully screened admitted pool.

**Owner review of the third measurement (2026-10-01).** After reading the
by-name report, the owner corrected seven labels: three excludes became
keeps, three keeps became excludes, and one exclusion reason changed. The
private reviewed dataset `usefulness-pool-reviewed-v1` contains all 110
labelled sample words with these corrections. The original exports and blind
measurement reports are preserved. Neither combiner was refitted; both fixed
rankings were evaluated against the same reviewed labels.

| Combiner | Gate's top | Keeps | Precision | Cutoff | Projected admitted pool |
| --- | --- | --- | --- | --- | --- |
| `c35a2cbf` | 24 | 21 | 0.875 | 0.628 | about 1,006 |
| `c35a2cbf` | 27 | 22 | 0.815 | 0.577 | about 1,132 |
| `c35a2cbf` | 40 | 24 | 0.600 | 0.481 | about 1,677 |
| `e9d29c21` | 24 | 21 | 0.875 | 0.597 | about 1,006 |
| `e9d29c21` | 26 | 22 | 0.846 | 0.580 | about 1,090 |
| `e9d29c21` | 27 | 22 | 0.815 | 0.575 | about 1,132 |
| `e9d29c21` | 40 | 23 | 0.575 | 0.480 | about 1,677 |

Both reach the numerical bar on reviewed labels. Among ranks 1 through 40,
the largest qualifying prefix is the top 27 for both. Top-40 wrong admits
are 13 too familiar and 3 too specific for `c35a2cbf`, and 14 too familiar
and 3 too specific for `e9d29c21`. These are post-review results, not a new
blind measurement or evidence of a ranking improvement. The projection caveat
above still applies. The owner subsequently approved the configuration below.
The corrections and reviewed by-name reports are private. No model requests
or cost.

**Evidence accepted by the owner.** The owner accepted the reviewed results
as sufficient evidence to proceed with choosing a production configuration,
and deferred a fresh blind 80-word check until a later date if needed.
[Decision on #11](https://github.com/cwebley/word-well/issues/11#issuecomment-5940800815).
The owner then [approved `e9d29c21` weights at a 0.58 cutoff](https://github.com/cwebley/word-well/issues/11#issuecomment-5940925373),
recorded as artifact `effc8eb93ba0`. Its 26 admits contain 22 keeps, precision
0.846, with a projected pool of about 1,090 words.

Development numbers are optimistic because each combiner is fitted on the words
it is scored on. Cross-validated precision and recall: `27dab670` 0.714 and
0.714 (lab answers), `152642aa` 0.783 and 0.839, `d7022878` 0.770 and 0.825.
Development numbers do not count toward the pass bar. The promotion above uses
the owner-accepted reviewed version of the held-out sample.

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

- Remaining usefulness gate contract work, including whether meaning obviousness
  needs a separate veto. The approved combiner has no independent veto (#11).
- Jev on the v1 route: parity re-run and account-level zero data retention.
- Braintrust `trialCount` behavior, to confirm against its docs.
