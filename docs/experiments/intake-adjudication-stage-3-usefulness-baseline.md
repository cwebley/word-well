# Intake Adjudication Stage 3

This document records aggregate findings from the usefulness and audience-risk
spikes. Raw model records, challenge cohorts, evidence extracts, and generated
HTML reports remain local and are ignored by Git.

## V14 Usefulness Gate

V14 judges one headword at a time using the headword, recorded parts of speech,
and general knowledge of ordinary English usage. It reports familiarity, scope,
and learning value. A deterministic policy advances only general, high-value
findings; specialist, sensitive, low-value, or unknown findings do not advance.

The experiment made 262 unique calls across 266 dataset appearances, with four
reused records and no contract failures.

| Dataset | V13 | V14 | Notes |
| --- | ---: | ---: | --- |
| Golden label match | 15/16 | 16/16 | V14 recovered the labelled regression |
| Retention audit | 86/100 | 74/100 | Unlabelled diagnostic set |
| Exploration draw 1 | 32/150 | 30/150 | Unlabelled diagnostic set |

The result supports a headword-level seam rather than folding independent
source-meaning judgments into a product decision. It does not establish an
accuracy rate: the labelled set is small and owner-labelled.

## V15 Audience-Risk Gate

V15 is a separate gate. It receives the headword, recorded parts of speech, and
per-sense usage-label evidence where available. It reports familiarity and one
of three audience-risk findings: `clear`, `sensitive`, or `blocked`. The model
does not emit a disposition.

The initial cohort contained 204 rows and 198 unique persisted calls, with no
contract failures.

| Cohort | Total | Clear | Sensitive | Blocked |
| --- | ---: | ---: | ---: | ---: |
| Label-flagged challenge slice | 68 | 10 | 38 | 20 |
| Control slice | 20 | 18 | 2 | 0 |
| V14 keep leakage check | 110 | 107 | 3 | 0 |

The label signal was useful as positive evidence but incomplete as a safety
signal. The model added information on the challenge slice, while the control
and V14-keep slices exposed the cost of treating every risk signal as a hard
block.

## Corrected Stress Run

A later stress run used 307 unique in-band headwords selected through external
category membership while withholding that membership and usage labels from
both judges. The corrected harness sent strict JSON schemas and used fresh
evidence fingerprints. Both gates completed with zero contract errors.

| Gate | Advance / clear | Exclude / blocked | Quarantine / sensitive |
| --- | ---: | ---: | ---: |
| V14 usefulness | 16 | 291 | 0 |
| V15 audience risk | 109 | 120 | 78 |

The cross-gate matrix showed that V14 did substantial filtering but was not an
audience-safety gate. V15 added the missing distinction for words that remained
useful enough to reach the safety stage.

## Current Policy

Human review selected an aggressive exclusion policy. The model still reports
`sensitive` versus `blocked` for diagnostic value, but both findings are
excluded by policy:

| V15 finding | Policy 6 |
| --- | --- |
| `clear` | `advance` |
| `sensitive` | `exclude` |
| `blocked` | `exclude` |
| Unknown or contract failure | `quarantine` |

Recomputing the corrected stress findings required no new model calls:

| Result | Count |
| --- | ---: |
| Advance | 109 |
| Exclude | 198 |
| Quarantine | 0 |

This is a product tradeoff, not an accuracy claim. It prefers excluding a
plausibly risky headword rather than relying on a later human rescue.

## Proposed Intake Shape

1. Candidate-pool filters narrow the source pool.
2. Programmatic usage labels provide cheap risk evidence; missing labels do not
   imply safety.
3. V14 judges whether the headword rewards deliberate study.
4. V15 judges audience risk separately and maps the finding to deterministic
   policy.

The prototype supports this ordering locally. It does not yet promote V15,
reactivate every candidate-pool filter in the production chain, or provide a
production-ready sense-scoped risk model. The current V15 product decision is
headword-level, and sense-specific policy remains a separate design task.
