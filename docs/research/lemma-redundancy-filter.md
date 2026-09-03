# Lemma Redundancy Filter

Issue #59 adds a pool-layer flag for a narrow class of derivations. It does not
call a model and it does not modify evidence generation. The flag records the
root that should be preferred, so a later intake stage can defer the derivative
without losing the reason.

## Rule

Flag a row only when all of these hold:

- `f_derived=1` and `derived_root` resolves to another pool row
- the derivative is a noun ending in `-ness` or `-ity`, or is an adverb-only
  `-ly` form
- the root is not itself transparent, derived, or meaning-shifted
- the root does not carry a meaning-bearing `-ist`, `-ism`, `-ish`, or `-ful`
  suffix

The last condition keeps a grammatical outer derivation such as `fruitfulness`
from hiding the meaning-bearing step in `fruitful`.

## Measurement

Measured against pool snapshot
`a54bb48e144d07108e6f72a0a3f2336b1d8e846e40c958522d969164cd456aa1`:

- 50,860 pool rows
- 689 flagged rows, or 1.35%
- stratified manual sample: 22 distinct root/derivative pairs, evenly sampled
  from the `-ity`, `-ness`, and `-ly` buckets
- 0/22 structural misfires in that sample

The sample included `ability/able`, `captivity/captive`,
`abrasiveness/abrasive`, `busyness/busy`, `easily/easy`, and `rabidly/rabid`.
The boundary probes behaved as intended: `naughtiness` and `tightness` flag;
`mercurial`, `fruitfulness`, `sinfulness`, and `costly` do not.

This is an inspectability check, not a claim that every semantic judgment is
mechanical. The flag remains separate from `export_evidence.py` and from the
usefulness gate.
