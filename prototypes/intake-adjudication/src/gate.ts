// What every intake gate has in common, and nothing else.
//
// There are two gates now — morphology and audience usefulness — and they agree
// on almost nothing. They ask different questions, of different subjects, with
// different evidence and different contracts. What they do share is the part
// that costs money and the part that must never drift: one path that calls a
// model, one fingerprint that keys the answer, one spend guard in front of both.
//
// So `Gate` is the seam. A gate supplies the four things the shared runner
// cannot know — how to address a subject, what to send, how to read the reply,
// and how policy turns a finding into a disposition — and the runner supplies
// everything a gate should not have to reimplement. The alternative was a second
// copy of `adjudicate`, which is how an experiment ends up measuring a prompt
// that is not the one under test.
//
// Note what a gate does NOT get to do: return a disposition from the model.
// `decide` takes a finding and produces the disposition itself, so the model's
// own view of what should happen is structurally unable to reach the outcome.

import type { Disposition, DispositionResult } from "./disposition.ts";

/**
 * The four version strings that key the config fingerprint.
 *
 * Separate rather than one, because they change for different reasons and mean
 * different things to a human label: a rubric change invalidates labels, a
 * prompt change does not.
 */
export interface GateVersions {
  prompt: string;
  rubric: string;
  contract: string;
  policy: string;
}

export interface Message {
  role: "system" | "user";
  content: string;
}

export interface ParseResult<TFinding> {
  /** The parsed JSON, retained even when invalid so failures stay inspectable. */
  raw: unknown;
  finding: TFinding | null;
  error: string | null;
}

/** The disposition after any policy context the gate applies on top of its own. */
export interface EffectiveDecision extends DispositionResult {
  /** True when policy context changed the gate's own answer. */
  overridden: boolean;
}

export interface Gate<TSubject, TFinding> {
  /** Stable identifier. Recorded on every run record and sent as the provider's schema name. */
  name: string;
  versions: GateVersions;
  /** The strict JSON schema sent to the provider, derived from the gate's zod contract. */
  jsonSchema: Record<string, unknown>;

  /** How this subject is addressed in records, labels and datasets. */
  subjectId(subject: TSubject): string;
  /** The digest of the fixed evidence, which keys the fingerprint. */
  inputDigest(subject: TSubject): string;

  buildMessages(subject: TSubject): Message[];
  parse(content: string, subject: TSubject): ParseResult<TFinding>;

  /** The gate's own disposition, derived from the finding and nothing else. */
  decide(finding: TFinding): DispositionResult;

  /**
   * Policy context applied after the gate has decided — endorsement, and only
   * where a gate's exclusion is a guess rather than a fact.
   *
   * Optional, and deliberately so. Morphology has one because a string heuristic
   * guessing at word formation should lose to an editor who put the word on a
   * study guide. Audience usefulness has none: endorsed words are the retention
   * audit's sample, and a gate that advanced them by rule would make the audit
   * report its own override back as a retention rate.
   */
  applyContext?(decision: DispositionResult, subject: TSubject): EffectiveDecision;

  /**
   * Context recorded alongside the run for later correlation. Never reaches the
   * prompt: `buildMessages` is the only thing that decides what a judge sees.
   */
  policyContext(subject: TSubject): Record<string, number>;
}

/** The default when a gate applies no context of its own. */
export function unchanged(decision: DispositionResult): EffectiveDecision {
  return { ...decision, overridden: false };
}

export type { Disposition, DispositionResult };
