# WordWell Context

This context defines the language for WordWell's vocabulary lessons and content
records.

## Language

**Word lesson**:
A daily learning unit for one headword that may present every source-backed
meaning accepted by WordWell's scope as long as the meanings are meaningfully
distinct. Its current content is used for both past and future lesson pages;
history does not freeze an older wording or example.
_Avoid_: Sense lesson, single-meaning lesson

**Meaning**:
A recorded, meaningfully distinct use of a word that can be explained and
demonstrated in context.
_Avoid_: Sense, definition (when referring to the concept rather than its learner-facing wording)

**Published meaning**:
A source-backed meaning included in a learner-facing WordWell lesson after
scope review. Excluded source meanings remain pipeline evidence and are not
shown to learners.
_Avoid_: Learner sense, accepted sense

**Unavailable lesson**:
A delivered word that remains in learner history after its current content is
withdrawn or under quality review. History marks it unavailable and removes
the detail link rather than showing the withdrawn content.
_Avoid_: Deleted lesson, hidden lesson

**Content pipeline**:
An offline process that turns candidate words and pinned source evidence into
published WordWell vocabulary records or quarantined records.
_Avoid_: Live tutor, runtime generation

**Evaluation set**:
A versioned, hand-curated collection of complete word lessons, including
per-meaning cases, used to judge content quality before publication.
_Avoid_: Test suite, benchmark (when referring to the WordWell content set)

**Content evaluation**:
An assessment of a word lesson's grounding, factuality, meaning coverage,
naturalness, practical usefulness, duplicate protection, and contextual-practice
discrimination.

**Quarantined record**:
A generated vocabulary record withheld from learner publication because a
deterministic gate, quality threshold, evaluator disagreement, or required
human review was not cleared.

**Passkey**:
A cryptographic authenticator held by a learner's device or password manager
and unlocked by that device's local verification. WordWell receives proof of
the passkey, never the learner's biometric or device PIN.

**Recovery email**:
An optional, verified email address used only to regain access to a protected
profile when its passkeys are unavailable. It is not required for onboarding
and is not an analytics identity.

**Anonymous profile**:
A server-side learner profile with no passkey or recovery email, reachable only
through its existing session and subject to the anonymous inactivity lifecycle.

**Protected profile**:
An active profile with at least one registered passkey. It may also have an
optional verified recovery email for regaining access when passkeys are lost.

**Session**:
A revocable, time-limited grant to use a profile from one client context. It is
not the profile's identity and does not make local installation a recovery
factor.

**Meaningful history**:
Use of WordWell on three distinct days, the initial threshold at which the
product may offer profile protection.

**Profile tombstone**:
A server-side deletion marker that prevents access and rejects later writes for
a deleted profile while deletion completes across live data, backups, and
clients.

**Daily delivery**:
The single new word assigned to a learner for a local calendar date. A missed
date creates no backlog and does not permit an extra word later.

**Reserved upcoming word**:
An eligible, undelivered word provisionally held in a learner's bounded `Up
next` queue. It is not a daily delivery and is not eligible for history or
practice until the server assigns it to a local calendar date.

**Skipped upcoming word**:
A reserved upcoming word the learner declines before delivery. WordWell removes
it from the queue and excludes it from that profile's future selection.

**Familiarity**:
The learner's self-reported prior knowledge of a delivered word, recorded before
the lesson is read and used as initial scheduling evidence.

**Word difficulty**:
An editorial estimate of how challenging a word is based on frequency, register,
usage or meaning complexity, and practical usefulness. It is separate from any
learner's mastery.

**Adult-interest candidate**:
A published word lesson eligible for delivery because it may be unfamiliar yet
useful to a degree-educated adult in reading, writing, conversation, or precise
thought. Test-prep and advanced school vocabulary are valuable sources of such
candidates, not automatic inclusions.

**Starting band**:
The learner's initial adult-interest candidate range. `Build foundations`
contains approachable but worthwhile words, `Stretch my vocabulary` is the
default broad range, and `Challenge me` favors rarer, more specialized, or more
linguistically demanding words. No band includes remedial vocabulary.

**Editorial review signal**:
Aggregate learner feedback, including skip and replacement patterns, that
prompts human review of a word lesson or its delivery eligibility. It does not
automatically change a word's publication or delivery status.

**Editorial feedback review**:
A human assessment of a word lesson prompted by a configurable aggregate
feedback threshold or opened manually. It may leave the lesson unchanged,
adjust future-delivery ranking, suspend future delivery, or escalate withdrawal
to the content pipeline.

**Delivery suspension**:
An auditable stop on future delivery of a word lesson. It preserves existing
lesson pages and history until a separate withdrawal makes the lesson
unavailable.

**Learner mastery**:
The explainable, changeable estimate of how readily a learner can recall and use
a delivered word, informed by familiarity, practice, elapsed time, skips, and
active-use state.

**Recall stage**:
An explicit scheduler state that determines when a delivered word next appears
for optional practice. It advances or retreats from practice evidence rather
than representing permanent knowledge.

**Practice attempt**:
A submitted answer to one contextual-use question for a delivered word. The
learner receives immediate explanation; the attempt becomes evidence even though
WordWell does not expose a score.

**Offline cache**:
A bounded local copy of published WordWell content and downloaded learner state
that supports reading and practice without a network connection. It is not the
authoritative profile.

**Sync outbox**:
A bounded local queue of idempotent learning-state changes made while offline.
It excludes new delivery, credential, recovery, and deletion operations.

**Synchronization**:
The process of reconciling an offline cache and sync outbox with the server
profile. Server state, deletion tombstones, and current content take precedence
over local copies.

**Client context**:
A browser or installed PWA instance using a session to access a profile. It may
have its own local cache and outbox and is not itself a recovery factor.
