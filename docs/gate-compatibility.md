# Zero-generation gate compatibility

The owner-approved repair contract is on
[#34](https://github.com/cwebley/word-well/issues/34#issuecomment-6069716932).
It permits a specific compatibility proof for unchanged Jev gates. It does not
create a promotion decision or authorize a model call.

```text
original promotion + frozen evaluation + original paid replies
    -> current reassessment + exact historical evidence reconstruction
    -> append current assessment and promotion compatibility proof
ready source bundle + current intake + original selected gate replies
    -> current request, provider, output, policy and provenance checks
    -> append gate-result compatibility proofs
    -> read-only downstream authorization using original result IDs
```

## What changed

The old gate reuse hash included all of `pipeline/execution/model.ts`, although
both Jev stages import it only for erased types. Luna's verification types changed
that hash without changing either gate. `pipeline/reuse.ts` now hashes the stage,
its rendered request, configuration, Zod dependency, executable System One
adapter and executor. Usefulness also binds the exact source bundle. Current intake and owner
promotion remain separate authorization checks.

For historical results, the checker reconstructs only three known whole-file
identities: before Luna verification, with `verification_pending`, and with
`verification_unresolved`. The pre-Luna text is pinned by SHA-256 in
`pipeline/compatibility/model-before-luna.txt`. It is evidence text, never imported
runtime code. Reconstruction uses current gate/adapter bytes. A changed gate,
request, threshold, provider behavior, validation, dependency or usefulness bundle
therefore cannot inherit a historical result through this path.

Historical reuse also requires the original whole-production implementation to
match the inspected `ea7ea70`, `b6927a2` or `b97ee19` lineage. Both retained
evanescent gates match `ea7ea70`. Carry-forward requires the exact inspected
current executor and System One adapter bytes. A future executable change cannot
reuse this approval merely because its saved answers still pass validation.

Appropriateness promotion has a separate problem. The original rule hashed the
shared scorer file. Adding the unresolved Luna state changed its rule identity.
`pipeline/gate-promotion-compatibility.ts` accepts only the approved transition
from `c1c53e7f137fe21bed9d6b4c537303d00f6c2ec7b51508244b8e69a386066b37`
to `3fdac0db3fdcfb654c32f04344b3913fcf1550af6d68597dbe9f969427546fee`.
The original `pipeline/promotion.ts` assessor and strict checker retain their
original source bytes. The production coordinator uses `requireGatePromotion`,
which first runs the strict checker, then requires an additive proof for that
specific historical transition.

The current store also returns an empty `verifications` array for old Jev
requests. The current reassessment binds this current representation. A second,
in-memory calculation removes only arrays proven empty and must recover the exact
original approved evidence identity. Real verification rounds cannot be omitted.
All remaining assessment fields, including the original implementation, finalized
summary, frozen dataset and development reporting, must match. Matching aggregate
accuracy alone is insufficient.

Promotion proof consumption also recomputes a SHA-256 binding of the encrypted
evaluation rows in a read-only PostgreSQL snapshot. It covers the original
held-out experiment and its approved development experiments, including labels,
membership, attempts, requests, accounting, verification rounds and saved scores.
This check needs no dataset key. Later evidence changes invalidate the proof.

## Commands and persistence

Apply the private schema migrations before revalidation. Migration 014 adds
`private.gate_compatibilities`; it does not update historical rows. Its encrypted
records reference the original promotion or result and bind original/current
identities, evidence and the compatibility checker implementation. Learners cannot
read this table. PostgreSQL rejects updates and deletes.

```sh
npm run pipeline -- compatibility revalidate-promotion --dataset appropriateness-v000007
npm run pipeline -- compatibility revalidate-gates --candidate evanescent --bundle 4d84648896fd8a734d5742c833a0e370a0a4664f5d22cdc9789c1e5e67ee389d
```

`pipeline/gate-compatibility-commands.ts` exposes these explicit operations. The
promotion operation reads frozen labels using the evaluation store. The gate
operation uses a production store without the dataset key. Its provider transport
always rejects dispatch. Neither operation has a metadata recovery method or
reads a provider credential. No new production run, attempt, selection, promotion
decision or receipt is created.

The promotion operation appends one current assessment and one compatibility
record. The gate operation revalidates each available live stage independently.
`--stage appropriateness` stops after that gate. `--stage usefulness` requires
usefulness evidence and revalidates its appropriateness prerequisite too.
An appropriateness-only history can receive its proof before usefulness exists.
Valid appropriateness rejections and usefulness exclusions can receive proofs
and remain reusable with zero calls. Appropriateness rejection stops further gate
revalidation. Downstream authorization still requires appropriateness acceptance
and usefulness advancement. Failed, unresolved or invalid evidence cannot receive
a reusable-result proof.

Rerunning with identical evidence and checker bytes returns the same proof IDs.
Concurrent identical inserts retain the first ciphertext. A conflicting payload
under an existing identity fails. A checker change requires a fresh explicit
revalidation and appends a new proof under its new policy identity. Historical
proofs remain saved.

Inspection and downstream authorization do not write compatibility records. They
require the current owner's decision and proof binding, then validate the original
saved gate replies again. A later `do_not_promote` decision takes precedence over
every old proof. Missing proof, an unknown historical identity or changed content
blocks authorization. A partially interrupted revalidation can be rerun without
generation; it cannot replace a paid answer.

## Retained evanescent trace

The read-only preview uses the actual saved source bundle
`4d84648896fd8a734d5742c833a0e370a0a4664f5d22cdc9789c1e5e67ee389d` and
headword `evanescent`.

1. `pipeline/gate-promotion-compatibility.ts` reads promotion
   `55d33594-0110-4147-b99c-8804debfb74a`, still bound to original assessment
   `55634f8be403678ae9479b9d3835906daa33704e27a4108c1680428daaafcd3d`.
   The frozen held-out experiment is `26c79436-6675-4181-bf41-df1cd5444da7`.
   Current validation reproduces 20/21 correct averages and all 63 valid trials.
   Historical reconstruction recovers evidence identity
   `2a025cec4d52ccaf6be7299c85984a7087d62110695d92eeaa5ca4e4d3d2a37e`.
   Only the new assessment and compatibility record can persist.
2. `pipeline/run.ts` authorizes the ready source bundle and current intake, then
   revalidates appropriateness result `5dd73d4b-f0e5-47c9-8ee7-08719168ddaa`
   and usefulness result `805080d6-afe8-49fe-be7c-e1bef4c44351`. It checks their
   original run instructions, trial membership, requests, original responses,
   averaged decisions and generation provenance. Only the compatibility records
   can persist. Both original selections and reuse identities remain unchanged.
3. `authorizeDownstream` returns these same result IDs under current gate
   authorization. Planner/writer review and promotion remain subsequent checks.
   No planner v4 or writer v1 evidence becomes approval of current v5/v2
   configurations. The frozen runtime retains exact historical review identities.

The trace exposed the empty-verification-array evidence hash difference as well
as the two reported rule/reuse blockers. The preview passed the real authorization
interface with proposed records held only in memory, zero database evidence writes
and zero provider calls. Private replies, labels and preservation artifacts remain
outside Git.

The approved repair was then applied to the retained local development database.
The public compatibility commands appended one current assessment and three
compatibility records. Repeating both commands returned the same proof IDs.
The real writer dry-run now passes both gate checks and stops at
`planner_configuration_not_promoted`.

Before/after verification preserved all 14,698 inherited rows across 34 private
tables and all 34 frozen-dataset, finalized-summary and receipt files inspected.
It found no new production run, generation request, review, promotion decision,
selection or accounting change. Both saved planner v4 and writer v1 experiments
still have three valid trials, their original three physical requests and settled
charges. The frozen runtime's 361 source files, 12,684 installed runtime files and
original review identities also verified. Provider fetches, model calls and
metadata calls were all zero.

Regression coverage in `pipeline/promotion.test.ts` and `pipeline/run.test.ts`
uses restricted disposable PostgreSQL databases and synthetic HTTP replies. It
checks persistence, restart, idempotency, original decision/selection/receipt
preservation, later non-promotion, unknown rule/evidence rejection, unrelated Luna
type additions, changed provider cache or executor request behavior remaining
non-reusable, and evidence appended after promotion invalidating the saved proof.
