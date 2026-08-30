// The three outcomes, shared by every gate.
//
// One vocabulary across gates rather than one per gate, because what happens to
// a candidate afterwards must not depend on which gate spoke. `advance` hands it
// to the next gate, `quarantine` holds it for a human, `exclude` removes it from
// the candidate pool's servable set.
//
// The human label vocabularies differ — usefulness is labelled serve / reject /
// borderline, because that is how the product owner thinks about a word — and
// each gate's dataset maps its buckets onto these three.

export const dispositions = ["advance", "quarantine", "exclude"] as const;
export type Disposition = (typeof dispositions)[number];

export interface DispositionResult {
  disposition: Disposition;
  reason: string;
}
