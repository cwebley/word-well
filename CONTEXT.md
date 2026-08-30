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

**Source meaning**:
One unit of meaning as a pinned source records it, with its own source
identifier, definition text, and part of speech, before WordWell's scope
review. Sources divide meaning more finely than a learner needs, so several
source meanings may merge into one published meaning and others may be
excluded.
_Avoid_: Sense, source sense, synset

**Published meaning**:
A source-backed meaning included in a learner-facing WordWell lesson after
scope review. Excluded source meanings remain pipeline evidence and are not
shown to learners.
_Avoid_: Learner sense, accepted sense

**Practice item**:
A published, versioned contextual-use question belonging to one published
meaning and to the lesson content version it was written against. Practice
items are generated, evaluated, published, and withdrawn independently of the
lesson body, so a bank can be replenished without redrafting the lesson.
_Avoid_: Practice question, flashcard, practice card

**Unavailable lesson**:
A delivered word that remains in learner history after its current content is
withdrawn or under quality review. History marks it unavailable and removes
the detail link rather than showing the withdrawn content.
_Avoid_: Deleted lesson, hidden lesson

**Content pipeline**:
An offline process that turns candidate words and pinned source evidence into
published WordWell vocabulary records or quarantined records.
_Avoid_: Live tutor, runtime generation

**Nomination**:
A record that an external editorial source proposed a headword for
consideration, such as a word-of-the-day list or a test-preparation list.
Nomination provenance records which source proposed a word and when. It is
never learner-facing content and is distinct from the source evidence that
backs a published claim.
_Avoid_: Candidate source, suggestion, referral

**Candidate pool**:
The deduplicated set of headwords eligible for consideration, derived from a
pinned frequency list resolved to source lemmas, with each intake filter
recorded as an attribute rather than applied as a deletion. It is not a
publication queue: membership means a word may be considered, never that it
will be delivered.
_Avoid_: Word list, corpus, dictionary

**Endorsement**:
A count of how many independent editorial sources nominated a headword. It is
evidence about a word's interest, used as a ranking prior and to override
mechanical intake filters that only guess at word formation. It never overrides
a factual filter such as spelling variant or register.
_Avoid_: Vote, score, popularity

**Intake adjudication**:
A judgment pass over headwords that mechanical intake filters flagged but could
not decide, recording a verdict per word as data alongside the mechanical
attributes. It exists because affix and compound rules invent word formation
that does not hold, and because no rule separates a derivation that teaches
something new from one that does not.
_Avoid_: Cleanup, moderation, review

**Config fingerprint**:
The identifier for one reproducible pipeline configuration, derived from the
pinned source releases, the extraction version, and the model, prompt,
evaluator, rubric, and deterministic rule versions. It keys idempotent job
runs, records what produced a record, defines when a published record is
stale, and gates which configurations may publish.
_Avoid_: Run id, pipeline version, build hash

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
An eligible, undelivered word provisionally held in a learner's server-managed,
five-deep `Up next` queue. WordWell displays the first three. It is not a daily
delivery and is not eligible for history or practice until the server assigns
it to a local calendar date.

**Skipped upcoming word**:
A reserved upcoming word the learner declines before delivery. WordWell removes
it from the queue, excludes it from that profile's future selection, and
appends one eligible replacement when online. A daily delivery cannot be
skipped.

**Familiarity**:
The learner's self-reported prior knowledge of a delivered word, recorded before
the lesson is read and used as initial scheduling evidence.

**Word difficulty**:
An editorial estimate of how challenging a word is based on frequency, register,
usage or meaning complexity, and practical usefulness. It is separate from any
learner's mastery, and distinct from a word rating, which is measured rather
than estimated.

**Word rating**:
A word's measured difficulty on the shared rating scale, seeded from its
frequency and revised as learners report familiarity. A word rating drifting
above its frequency prior means the word is better known than frequency
predicted. A word is retired from delivery once its rating passes the band
ceiling by a margin, not at the ceiling itself, so a word near the boundary is
not served once and lost.
_Avoid_: Difficulty score, Elo, weight

**Learner rating**:
A learner's measured position on the same scale as a word rating, seeded from
their starting band and revised by familiarity and practice evidence. The gap
between a learner rating and a word rating predicts familiarity, and the size of
each revision scales with how surprising the outcome was. It is distinct from
learner mastery, which concerns individual delivered words.
_Avoid_: Level, skill score, ability

**Adult-interest candidate**:
A published word lesson eligible for delivery because it may be unfamiliar yet
useful to a degree-educated adult in reading, writing, conversation, or precise
thought. Test-prep and advanced school vocabulary are valuable sources of such
candidates, not automatic inclusions. Eligibility is judged on a word's most
useful meaning rather than on its headword alone, so a rare word with a live
figurative meaning can qualify.

**Starting band**:
The learner's initial position on the rating scale, chosen at sign-up and
changeable at any time. `Build foundations` contains approachable but worthwhile
words, `Stretch my vocabulary` is the default broad range, and `Challenge me`
favors rarer, more specialized, or more linguistically demanding words. No band
includes remedial vocabulary. A band sets a starting point for a learner rating
rather than fixing a range: learners move continuously across band boundaries as
their rating changes.

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
A submitted answer to one served practice item for a delivered word. The attempt
retains the identity of the item served. The learner receives immediate
explanation; the attempt becomes evidence even though WordWell does not expose a
score.

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
