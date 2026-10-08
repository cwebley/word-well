# Single-response Luna verification

Future planner and writer runs decide from the original completion. The approved
decisions are on [#28](https://github.com/cwebley/word-well/issues/28), especially
comments 6065877255, 6066133972 and 6066320116.

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
- `openrouter_metadata.attempt` equals 1, with an explicit `attempts` array of
  exactly one successful response. That response must report status 200, provider
  `OpenAI` and model `openai/gpt-5.6-luna-20260709`.
- Exactly one selected endpoint, with that same dated model and provider. Other
  candidate endpoints do not establish which model served the request.
- No contradictory response-cache evidence. A returned cache status must be
  `MISS`; cache-source and cache-age headers cannot indicate a replay. A returned
  generation-ID header must match the completion ID.

The request's dated slug and metadata `requested` field describe request intent.
Neither substitutes for returned upstream evidence. `attempt: 1` does not
substitute for the explicit one-entry history. An undated alias in either the
selected endpoint or the attempt leaves verification unresolved. Missing or
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

Synthetic HTTP checks verify this contract and SDK transport support. No real
inline Luna completion has established that the provider always returns these
required fields. An optional omitted attempt history can therefore end a usable,
charged answer as unresolved.

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

Current configurations are planner v5 and writer v2. They fingerprint the strict
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
