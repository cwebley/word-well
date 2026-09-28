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

Development numbers are optimistic: the combiner was fitted on 109 of these
words. Cross-validated on replayed lab answers it scored 0.714 precision and
0.714 recall. Only held-out numbers count toward a pass bar.

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
