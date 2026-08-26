# WordWell Product Brief

## Product

WordWell is an installable mobile PWA for adults who want to use a more
precise, useful English vocabulary in everyday and professional conversation.
It is not a test-preparation product, a generic Word of the Day feed, or a
conventional flashcard app.

The promise is practical production: teach what a word means, when it helps,
when it sounds wrong, and give the learner a lightweight way to retain it.

## First-Release Learner

- Adults learning General American English vocabulary.
- Interested in everyday and professional expression rather than SAT, GRE, or
  another formal test.
- Wants a low-effort daily habit, with optional practice when they choose.

## Core Experience

1. A learner selects one of three plain-language starting bands: `Build
   foundations`, `Stretch my vocabulary`, or `Challenge me`.
2. They receive one new single-word lesson per calendar day. They cannot request
   extra new words, but may practice as much as they want.
3. Before reading the explanation, they report prior familiarity:
   `Never seen it`, `Seen it, unsure`, `Know the meaning`, or `Could use it
   naturally`.
4. The word page contains a concise definition, pronunciation, a natural
   example, `Use it when`, `Don't use it for`, and natural synonyms.
5. An optional expanded section contains word-nerd material when it is useful,
   such as etymology, a practical frequency/register label, related words, and
   common confusions. It must not become decorative filler.
6. An optional, unlimited Practice queue revisits delivered words with a
   contextual-use question: choose the correct one of two short sentences.
   Feedback is immediate and explains why the other sentence is wrong.
7. A `Due for recall` area can surface prior words, separate from the current
   daily lesson.
8. A chronological history lists every delivered word with familiarity and
   practice state, and opens each word's detail view.

## Personalization And Retention

Word difficulty and learner mastery are separate concepts.

- Word difficulty is an editorial estimate based on frequency, register,
  usage/meaning complexity, and a practical-use rubric.
- Learner mastery is estimated from the selected starting band, familiarity,
  contextual-practice performance, skips, elapsed time, and active-use state.
- The initial scheduler is a simple, explainable heuristic. It records the
  inputs required to fit a better memory model later, but does not attempt a
  trained memory-half-life model at launch.
- Practice only covers words the learner has already received.
- `I'm using this` and `Not using it yet` are changeable word states available
  from a due practice item or word history/detail. The latter is neutral: no
  opportunity to use a word is not failure.
- `I'm using this` modestly strengthens mastery and lengthens future recall
  intervals. It is not counted as repeated use and does not prove permanent
  mastery.

## Learner Feedback

The following signals are distinct:

- Familiarity: prior knowledge before a learner reads the lesson.
- Practice evidence: contextual-use answers.
- Personal utility: `Useful to me` or `Not useful to me`.
- Active use: `I'm using this` or `Not using it yet`.
- Content quality: `This seems wrong`, with optional categories later.

Utility and content-quality controls appear at the bottom of a word page and
on the detail view reached from history. A single `Not useful to me` report is
recorded but does not immediately change delivery. Aggregate, sufficiently
strong feedback can nominate an item for content regeneration/review.

## Content Scope

- Initial delivery units are single English words only, not expressions,
  idioms, or specialized terms.
- Optimize for General American English and mention regional variation only
  where it materially affects use.
- Candidate words come from corpus frequency, register, and usefulness signals.
  A SAT-style list may be one input, but is not the product boundary.
- Reject archaic, test-prep-only, performative, and impractical vocabulary.
- Use qualitative, curated frequency/register guidance such as `uncommon in
  casual conversation; common in professional writing`, not misleading numeric
  precision.

## AI Content System

The portfolio AI system is an offline, multi-stage content pipeline, not a
live tutor in the learner's daily experience.

- Candidate words are enriched into structured records: definition, examples,
  use/don't-use coaching, synonyms, etymology, frequency/register guidance,
  and contextual practice prompts.
- Definitions, etymology, usage-frequency/register labels, and factual claims
  must be grounded in a source. Natural examples and practical coaching may be
  generated.
- Specialized generation and evaluation stages should cover grounding,
  factuality, naturalness, practical usefulness, duplicate examples, and whether
  the incorrect practice sentence is clearly wrong for the intended reason.
- Deterministic gates enforce required fields, schema validity, length bounds,
  prohibited claims, source presence where required, and duplicate protection.
- Qualifying records publish automatically. Failed or low-confidence records are
  quarantined with evaluator feedback for regeneration or inspection.
- Learner feedback feeds a later aggregate regeneration/review workflow.
- Build and validate an evaluation set before trusting generated content at
  scale.

## Identity, Privacy, And Data

- A learner begins with an anonymous server-side profile. It stores delivery
  history, mastery signals, practice, and first-party analytics.
- The profile identifier is never exposed as a public credential.
- After a learner has three distinct days of use, or opens history, invite them
  to attach a passkey and optionally verify a recovery email. Do not make this
  part of first-run onboarding.
- The passkey supports normal cross-device use; the optional recovery email
  handles losing all passkeys. Losing both means the profile is unrecoverable.
- The learner can permanently delete their profile, history, practice data, and
  analytics from settings.
- Installation is not account recovery. Same-device browser-to-installed-PWA
  continuity is convenient but must not be relied on across browsers or devices.

## PWA

- Make installation a visible product action: a prominent persistent `Install
  app` button before installation.
- On supporting Chromium browsers, the button triggers the deferred native
  install prompt. On iOS/iPadOS it shows concise Safari Add to Home Screen
  instructions.
- Do not auto-prompt for installation.
- Track install CTA shown, CTA started, and confirmed installation where the
  browser exposes it. Starting a flow is not proof of completion.
- The offline promise covers the current word, downloaded history, and practice
  for already downloaded words, including the 50 most recently delivered
  lessons. New deliveries and synchronization resume online.
- Ask for daily notification permission only after meaningful engagement, not on
  first launch.

## Validation Signal

The first leading indicator of value is learners returning on several distinct
days and completing a meaningful amount of optional practice. Installation is a
funnel metric; self-reported active use is a longer-term outcome.

## Explicitly Out Of Scope

- Learning circles and invite sharing.
- Live AI tutoring or generation in the learner's main path.
- Phrases, idioms, and specialized terms.
- Mandatory accounts or email at onboarding.
- A fitted memory-half-life model.
- A broad search/library product beyond chronological history.
- Automatic topic/register inferences from one `Not useful to me` report.
