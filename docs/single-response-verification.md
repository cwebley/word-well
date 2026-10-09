# Single-response Luna verification

Future planner and writer runs decide from the original completion. The approved
decisions are on [#28](https://github.com/cwebley/word-well/issues/28), especially
comments 6065877255, 6066133972, 6066320116 and
[the optional-attempt-list amendment](https://github.com/cwebley/word-well/issues/28#issuecomment-6087898686).

```text
dated Luna request + inline metadata enabled + response cache disabled
    -> original HTTP completion + selected response headers
    -> durable encrypted response + accounting receipt + settled reservation
    -> complete routing proof -> content validation -> valid or invalid
    -> missing proof -> terminal verification_unresolved
    -> contradictory proof -> failed routing
    -> next eligible independent evaluation trial, serially within the cap
```

`pipeline/execution/openrouter.ts` sends `X-OpenRouter-Metadata: enabled` and
`X-OpenRouter-Cache: false`. SDK retries remain disabled. Existing executor-owned
transport retries still share the recorded cap. The adapter has no metadata
verification method and makes no generation-metadata GET. There is no metadata
sleep, scheduled work, background service or replacement answer for missing proof.

## Evidence contract

`pipeline/execution/luna-response.ts` requires all of these returned facts:

- A `gen-` completion ID, a compatible completion model and completion provider
  `OpenAI`. The completion model may be the existing undated Luna alias only when
  the remaining evidence proves the dated upstream.
- `openrouter_metadata.attempt` equals 1. OpenRouter documents this as the
  1-indexed attempt number that succeeded. A greater number means earlier
  attempts failed and fell back.
- The detailed `attempts` array may be absent. When supplied, it must contain
  exactly one successful response with status 200, provider `OpenAI` and model
  `openai/gpt-5.6-luna-20260709`. Null, malformed, empty or incomplete supplied
  history remains unresolved. Explicit conflicting facts are rejected.
- Exactly one selected endpoint, with that same dated model and provider. Other
  candidate endpoints do not establish which model served the request.
- No contradictory response-cache evidence. A returned cache status must be
  `MISS`; cache-source and cache-age headers cannot indicate a replay. A returned
  generation-ID header must match the completion ID.

The request's dated slug and metadata `requested` field describe request intent.
Neither substitutes for returned upstream evidence. Current configurations use
`routingVerification: completion-inline-attempt-number-v1`, which accepts the
documented successful attempt number without requiring optional history. Saved
configurations with `completion-inline-strict-v1` retain their original mandatory
one-entry-history check. An undated alias in either the selected endpoint or a
supplied attempt leaves verification unresolved. Missing or
malformed required facts never pass. Explicit wrong models/providers, extra or
failed attempts, multiple selected endpoints, mismatched generation IDs and cache
hits are routing rejections, even when other evidence is missing.

The [router-metadata documentation](https://openrouter.ai/docs/guides/features/router-metadata)
states that cache hits strip router metadata. Complete current inline proof thus
establishes absence of response-cache replay even when `MISS` is absent. This is
returned evidence, independent of the opt-out request header. The
[response-cache documentation](https://openrouter.ai/docs/guides/features/response-caching)
documents header precedence and cache-source/age indicators. Provider prompt
caching is separate and does not reject a fresh response. Unknown additive
metadata fields do not invalidate otherwise complete proof.

Synthetic HTTP checks verify this contract and SDK transport support. Three saved
inline Luna completions returned the dated selected OpenAI endpoint and
`attempt: 1`, but omitted the optional detailed history. They remain unresolved
under their original strict interpretation. Offline replay passes the amended
routing and content checks without adding evidence or making a provider request.
Missing required facts in any future response still end a charged answer as
unresolved. This observed case does not establish provider-wide completeness.

## Persistence and reporting

The `wordwell-luna-exchange-v4` envelope contains the exact completion text and
cache status, source ID, age, TTL and generation-ID response headers. It is
captured before SDK parsing and saved as the original encrypted request response.
It does not impersonate a generation lookup. Accounting always reads the original
completion usage. Content-schema failures cannot discard its charge.

Migration `013_verification_unresolved.sql` adds an explicit terminal attempt
status. Its code is `luna_verification_unresolved`; routing rejection retains
`luna_routing_unverified`, and invalid content retains its stage-specific code.
Production reports an unsuccessful run with that unresolved code, releases its
claim and selects no new result. Existing valid selections survive a failed fresh
run. Dependent stages still require a validated, currently authorized result.

Writer and planner reports count unresolved verification, rejected routing,
invalid content, pending attempts and unstarted trials separately. Unresolved
trials remain in `requiredTrials` and never increase `validTrials`. Both promotion
rules require every required trial to be valid. Other eligible trials proceed
serially after unresolved verification. Accounting, storage, unresolved charges
and budget blockage stop progress. Existing stops for newly invalid content,
routing/transport rejection and uncertain requests remain in force.

Restart reads the saved terminal outcome. `recover` handles existing saved work
without dispatch; it does not add evidence to an unresolved trial or reopen it.
Experiment locks and candidate ownership fence concurrent commands and writes.
No provider key is needed to interpret a fully saved response.

## Historical identity and one retained trace

Before execution-code edits, the evaluated checkout was copied outside Git,
including its untracked writer additions and the installed dependency bytes.
The source/dependency SHA-256 manifest is `preservation-manifest.json` in the
frozen runtime. Credentials were not copied. Post-test verification checks every
source and installed runtime file; Vitest's generated result cache is excluded
from executable dependency identity.

Local preserved artifacts:

```text
/var/folders/zz/t__yz71d14d1tzyyzsh1r4tc0000gn/T/opencode/wordwell-frozen-runtime-20261008/
/var/folders/zz/t__yz71d14d1tzyyzsh1r4tc0000gn/T/opencode/wordwell-frozen-runtime-20261008.tar.gz
archive SHA-256: 7ec59936429a5194e04ca32d22937fb0f2b14001f67ffa3b9ad6c6f21c333fca
writer implementation: 8c2dc422adb33346554f5fe22afb5a870128e1590ddb70d3a24e228ed21f6fc9
writer tested rule: 58cf011a6656c0368feb2e28f0509dfaf62c72f6ba1f40868448531a4b8ee11f
```

The frozen `frozen-recovery.test.ts` invokes the actual historical
`evals/writer.cli.ts` `recover` entry. It uses a restricted disposable database,
synthetic metadata and isolated test keys/home/ledger. The original local-store
code, checkout-relative paths and ledger setup run from the copied checkout.
Only Keychain access and provider transport are replaced with test dependencies.
The check passed with one metadata read, zero sends, the same original response
and charge, no new intentional trials, and matching original fingerprints before
and after. Repeating recovery made no further reads. Installed dependencies are
copied, not linked to the changing working checkout.

The retained real checkpoint illustrates why preservation comes first:

1. `evals/writer.ts` retains experiment
   `5e03c264-95fc-4c35-9d39-f3569def7ca4` under the original implementation above.
   Its frozen dataset is version 2 and its required denominator is three trials.
2. `pipeline/execution/executor.ts` originally saved three charged responses. The
   retained ledger total is 2,951,400 nano-USD, with no outstanding reservation
   or unresolved charge.
3. Historical lookup evidence permitted content validation for two trials. The
   third retained trial is still pending metadata verification. Its original
   answer cannot gain inline evidence retroactively.
4. The current implementation decodes old envelopes for inspection, but refuses
   incompatible historical run/recover identities. Historical recovery belongs
   to the frozen runtime, without restamping fingerprints. Live reconciliation
   still needs explicit owner authorization.

This trace exposes a distinction that charge settlement does not resolve: all
three answers can be durably paid for while only two are verified. Applying the
new missing-proof outcome to that historical pending answer would rewrite its
policy identity. The repair applies to future experiments instead.

At the original repair checkpoint, planner v5 and writer v2 fingerprinted the strict
inline policy, response-cache opt-out and terminal missing-evidence outcome.
Historical configurations remain decodable but cannot create new runs. The new
implementation and review identities do not authorize older evidence.

Migration 013 has been exercised only in test databases. It has not been
applied to the retained private experiment database. No paid generation or live
historical reconciliation ran for this repair.

## Verification results

The final full suite passed 413 tests, with 12 skipped, across 40 files. Typecheck
and whitespace checks passed. The planner/writer persistence tests ran against
provisioned restricted disposable databases, including migration 013. They were
not skipped. Checks cover complete proof, missing/undated proof, contradictory
routing, cache replay, invalid content, independently retained accounting fields,
serial continuation, blocked progress, fresh-store restart, concurrent ownership,
historical decoding and incompatible historical recovery refusal.

Standards review found no documented-standard violations and one optional
duplication note for planner/writer reporting and continuation predicates. Spec
review found two gaps, both fixed and regression-tested: malformed evidence could
discard a valid returned cost, and truncation/refusal classification could bypass
routing verification. Follow-up spec review found no remaining findings.

## Optional attempt history checkpoint, 2026-10-09

The owner approved accepting the documented successful attempt number without
requiring the optional detailed list. `pipeline/execution/luna-response.ts` keeps
the mandatory history check for saved strict configurations and selects the
amended check only for `completion-inline-attempt-number-v1`. The adapter and
current planner v5 and writer v2 configurations use this new mode. Their request
bytes, prompts, output contracts, source inputs and spending controls are
unchanged. Effective configuration and implementation identities change.

Evaluation and production coordinators require the adapter's verification policy
to match the saved stage configuration before creating or executing work.
A mismatch stops with `luna_verification_policy_mismatch`; it cannot misclassify
missing strict proof as invalid content or a content refusal.

The effective planner configuration fingerprint is
`ea7df84a68c7118b954b445bde3e5683916e114ac0e25d2a70014e8f927c653a`.
The effective writer configuration fingerprint is
`23ef47dc15d4f7ecb4b1c4a4b355223237d6c65be58041a8d28b6a9fe65d7c57`.

Before editing, the evaluated current source and installed dependencies were
copied into a new private runtime and archived. All 13,085 preserved files and
symlinks verify against its manifest. The new archive SHA-256 is
`df941ef5447f6e975ad66ebcad6661db8b371899adda0dbf8987e1164a9d8b04`.
The earlier archive retains its original checksum. The incomplete earlier
extracted copy was not repaired or overwritten.

Offline replay of experiment `b22c4dd3-a565-45e7-9802-b602bbeaf224` verifies the
actual transition. Each saved response reports `attempt: 1` and one selected
dated OpenAI endpoint, without an `attempts` list. The frozen runtime and current
code under the saved strict configuration both reproduce unresolved verification.
The amended configuration passes routing, planner content contracts and the
unchanged required source-coverage expectations for all three responses.
This replay writes a private diagnostic report only. It does not turn those
original terminal trials into accepted results, record an owner semantic review
or support promotion by itself.

Preservation checks retain all 14,713 private rows across 35 tables, all 17
inspected frozen-dataset and ledger files, and six exact historical inspection
reports. Gate compatibility policy identity is unchanged. No model call,
generation-metadata lookup, historical reconciliation, promotion or production
selection ran at this checkpoint. The owner subsequently approved append-only
reuse of these paid answers. The new interpretation is recorded separately, with
original outcomes and identities preserved. See
[planner revalidation](lesson-planner.md#append-only-reuse-of-paid-planner-answers).

The final full suite passes 447 tests, with 12 skipped, across 41 files. Typecheck
and whitespace checks pass. Both standards and spec reviews have zero remaining
findings. Regression coverage includes policy mismatch before dispatch and strict
proof classification before truncation or refusal, as well as optional-history
acceptance, malformed supplied history and unchanged historical stage validation.
