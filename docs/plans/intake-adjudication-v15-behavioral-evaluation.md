# V15 behavioral evaluation dataset

Status: proposed. Run manually for now; automate through a manually triggered
CI workflow later.

## Purpose

The V15 audience-risk gate needs a labelled behavioral evaluation, not just
unit tests for its deterministic policy and not just an unlabelled stress
cohort. The evaluation should answer two questions:

1. Does the prompt identify the risk cases it is intended to catch?
2. Does it leave ordinary control cases alone?

The evaluation is a prompt and model regression instrument. It is not production
intake data and it must not become a source of learner-facing vocabulary.

## Dataset Shape

Each immutable dataset version contains a small, human-labelled set of cases in
a private artifact. A case has:

```json
{
  "id": "risk-positive-001",
  "headword": "<private headword>",
  "category": "positive",
  "expected_risk": "blocked"
}
```

The initial set should contain three slices:

- `positive`: cases the gate must identify as risky
- `boundary`: charged or ambiguous cases expected to receive `sensitive`
- `control`: cases that resemble the challenge set but should receive `clear`

The exact headwords and per-case expected findings stay in the private artifact.
The public repository contains only an opaque case ID, a broad category, and a
dataset manifest with aggregate expected counts. Opaque IDs are random stable
identifiers, not hashes of the headwords.

## Versioning

Dataset versions are immutable. A correction or added case creates a new
version, such as `v15-behavior/1` followed by `v15-behavior/2`; an existing
version is never edited in place.

The repository may commit a safe manifest like:

```json
{
  "dataset": "v15-behavior/1",
  "schema_version": "v15-eval/1",
  "case_count": 40,
  "sha256": "<artifact digest>",
  "expected_counts": {
    "positive": 20,
    "boundary": 8,
    "control": 12
  }
}
```

The evaluator downloads the named artifact and verifies its digest before any
model call. This makes a run on a developer laptop and a later run on another
server use the same words and labels.

## Storage And Access

The private artifact should live in an access-controlled, versioned location:

- a private repository
- an object-storage bucket
- or an encrypted release asset

A separate private artifact is preferred to ciphertext in the application
repository. The evaluator needs a credential only when the evaluation is run.
The current manual workflow can fetch the artifact locally; a future CI
workflow can fetch the same version using a repository or environment secret.

The raw headword necessarily goes to the model provider. That exposure is
separate from repository safety and must be covered by provider retention and
logging settings.

## Scoring

The private evaluator scores every case against its private expected finding.
The repository and shared reports expose aggregate results only:

- positive recall
- boundary classification rate
- control specificity
- false-negative count
- schema and identity validity
- deterministic policy correctness

The evaluator must not log raw headwords, per-case rationales, or raw model
inputs in span names, spend ledgers, generated HTML, issue bodies, or committed
files. Use the opaque case ID or a separate run digest for telemetry.

Aggregate counts are useful for a public regression summary, but they are not a
replacement for per-case scoring. A run can preserve the totals while assigning
the wrong result to individual cases, so the private scorer remains authoritative.

## Manual Workflow Now

Until the workflow is automated, a developer should:

1. Select an immutable dataset version and record its digest.
2. Fetch it into a local ignored path.
3. Run the V15 evaluator with the pinned model, prompt, rubric, contract, and
   policy configuration.
4. Review aggregate metrics and any locally retained failures.
5. Record the dataset version, configuration fingerprint, cost, and decision;
   do not copy raw cases or rationales into the repository.

The existing V15 model-run CLI and policy tests are not this evaluator yet. A
future evaluator command should make the dataset version and path explicit and
should refuse to run when the artifact digest does not match the manifest.

## CI Later

When the manual workflow is stable, add a manually triggered CI workflow rather
than running it on every pull request. The workflow should:

- accept an explicit dataset version
- fetch the immutable private artifact with a CI secret
- verify the artifact digest
- pin the model and configuration fingerprint
- enforce a spend ceiling
- redact raw inputs from CI logs and third-party traces
- publish aggregate results only

Automatic CI can be considered later once the recurring model cost, provider
retention, and secret-access policy are acceptable. The CI workflow should not
silently switch dataset versions or tune the prompt against the same cases it
reports.

## Open Decisions

- Which private artifact store should host the dataset?
- Should the manual evaluator use Braintrust with redacted traces or a local
  aggregate-only runner?
- Which credentials and provider retention settings are acceptable for the
  model calls?
- When should the manually triggered CI workflow become part of release checks?
