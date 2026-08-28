import { renderLessonCard } from "../components/card.js";
import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderPractice } from "../components/practice.js";
import { renderStatus } from "../components/status.js";
import { bindNavigation } from "../components/navigation.js";
import { renderProfile } from "../components/profile.js";
import { Profiles } from "../profiles.js";
import { WebAuthnSimulator } from "../webauthn-simulator.js";
import { HttpLearningStateAdapter, LearningStateClient } from "../learning-sync.js";

const html = String.raw;

const main = document.querySelector("#app-main");
let route = "today";
let familiarity;
let revising = false;
let practiceResult;
let syncStatus;
let deletionConfirmation = false;
let recoveryVerification;
let deleted = false;
const webauthn = new WebAuthnSimulator();
const profiles = new Profiles({ webauthn });
const profileSession = profiles.createAnonymousProfile().session;
let practiceVisit;
const adapter = new HttpLearningStateAdapter({
  baseUrl: document.documentElement.dataset.apiBaseUrl ?? "",
});
const learning = new LearningStateClient({
  server: adapter,
  profile: adapter.cacheKey,
});

void startLearning();
window.addEventListener("online", reconcileLearning);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void reconcileLearning();
});

function render() {
  if (deleted) {
    main.innerHTML = renderProfile({ profile: { state: "tombstoned" } });
    return;
  }
  if (route === "profile") {
    main.innerHTML = renderProfile({
      profile: profiles.profile(profileSession.id),
      deletionConfirmation,
      recoveryVerification,
    });
    return;
  }
  const delivery = currentDelivery();
  const lesson = currentLesson(delivery);
  if (!delivery || !lesson) {
    main.innerHTML = learningStatus();
    return;
  }
  if (route === "practice") {
    practiceVisit =
      practiceResult === undefined && familiarity
        ? practiceFor(delivery, lesson)
        : practiceVisit;
    main.innerHTML = familiarity
      ? practiceResult !== undefined
        ? renderPractice({
            practice: practiceVisit.practice,
            result: practiceResult,
          })
        : practiceVisit
          ? renderPractice({ practice: practiceVisit.practice })
          : renderStatus({
              label: "Practice",
              detail: "Nothing is due for recall right now.",
            })
      : renderStatus({
          label: "Practice",
          detail: "Record your familiarity before beginning practice.",
        });
  } else if (route === "history") {
    main.innerHTML = familiarity
      ? html`<section class="card flow">
          <p class="lesson-label">History</p>
          <h1 class="card-title">Words you've met</h1>
          <p><strong>${lesson.headword}</strong> · ${familiarity}</p>
        </section>`
      : renderStatus({
          label: "History",
          detail: "Your word history will gather here after today's lesson.",
        });
  } else if (!familiarity || revising) {
    main.innerHTML = renderFamiliarityGate({
      headword: lesson.headword,
      pronunciation: lesson.pronunciation,
      partOfSpeech: lesson.meanings[0].partOfSpeech,
      revision: revising,
    });
  } else {
    main.innerHTML = renderLessonCard({ lesson });
  }
}

bindNavigation(document.querySelector(".navigation"), {
  onNavigate(nextRoute) {
    route = nextRoute;
    if (route === "history") profiles.accessHistory(profileSession.id);
    practiceResult = undefined;
    practiceVisit = undefined;
    render();
    main.focus();
  },
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  if (target.dataset.action === "familiarity") {
    familiarity = target.dataset.value;
    recordLearning("familiarity", { deliveryId: currentDelivery().id, familiarity });
    revising = false;
  } else if (target.dataset.action === "revise-familiarity") {
    revising = true;
  } else if (target.dataset.action === "practice-answer") {
    practiceResult = target.dataset.value === "correct";
    recordLearning("practice", {
      deliveryId: practiceVisit.delivery.id,
      correct: practiceResult,
    });
  } else if (target.dataset.action === "active-use") {
    recordLearning("active-use", {
      deliveryId: currentDelivery().id,
      activeUse: target.dataset.value,
    });
  } else if (target.dataset.action === "utility") {
    recordLearning("utility", {
      deliveryId: currentDelivery().id,
      utility: target.dataset.value,
    });
  } else if (target.dataset.action === "content-quality") {
    recordLearning("content-quality", { deliveryId: currentDelivery().id });
  } else if (target.dataset.action === "retry-learning") {
    void reconcileLearning();
  } else if (target.dataset.action === "protect-profile") {
    profiles.protect(profileSession.id, webauthn.createPasskey("This device"));
  } else if (target.dataset.action === "add-passkey") {
    authenticateProfile();
    profiles.addPasskey(
      profileSession.id,
      webauthn.createPasskey("New passkey"),
    );
  } else if (target.dataset.action === "revoke-passkey") {
    authenticateProfile();
    profiles.revokePasskey(profileSession.id, target.dataset.value);
  } else if (target.dataset.action === "verify-recovery-email") {
    profiles.verifyRecoveryEmail(target.dataset.value);
    recoveryVerification = undefined;
  } else if (target.dataset.action === "start-profile-deletion") {
    deletionConfirmation = true;
  } else if (target.dataset.action === "cancel-profile-deletion") {
    deletionConfirmation = false;
  } else if (target.dataset.action === "confirm-profile-deletion") {
    authenticateProfile();
    profiles.deleteProfile(profileSession.id);
    void reconcileLearning();
    deletionConfirmation = false;
  }
  render();
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest('[data-action="add-recovery-email"]');
  if (!form) return;
  event.preventDefault();
  const email = new FormData(form).get("recovery-email");
  authenticateProfile();
  recoveryVerification = {
    email,
    ...profiles.requestRecoveryEmail(profileSession.id, email),
  };
  render();
});

function authenticateProfile() {
  const [passkey] = profiles.profile(profileSession.id).passkeys;
  profiles.authenticate(profileSession.id, webauthn.getPasskey(passkey.id));
}

function recordLearning(kind, details) {
  learning.record(kind, details);
  if (navigator.onLine) void reconcileLearning();
}

async function startLearning() {
  await learning.ready();
  const cached = learning.cache();
  familiarity = currentDelivery(cached)?.familiarity;
  render();
  if (navigator.onLine) await reconcileLearning();
}

async function reconcileLearning() {
  try {
    const result = await learning.synchronize();
    syncStatus = result.status;
    if (result.status === "deleted") deleted = true;
    if (result.status === "active") {
      familiarity = currentDelivery()?.familiarity;
      practiceVisit = undefined;
    }
  } catch {
    syncStatus = "offline";
  }
  render();
}

function currentDelivery(cached = learning.cache()) {
  return cached.history.find(({ status }) => status === "current");
}

function currentLesson(delivery, cached = learning.cache()) {
  return delivery && cached.lessons.find(({ id }) => id === delivery.lessonId)?.record;
}

function practiceFor(delivery, lesson) {
  if (!delivery.recall?.dueAt || delivery.recall.dueAt > new Date().toISOString()) return undefined;
  const attempts = learning.cache().evidence.filter(({ deliveryId, kind }) => deliveryId === delivery.id && kind === "practice");
  return { delivery, practice: lesson.meanings[attempts.length % lesson.meanings.length].practice };
}

function learningStatus() {
  const detail = syncStatus === "session-expired"
    ? "Your session has expired. Your unsent learning changes are still on this device."
    : syncStatus === "offline"
      ? "Your saved lessons are unavailable right now. Retry when you are connected."
      : "Your next lesson will appear here after it is delivered.";
  return html`<section class="card flow"><p class="lesson-label">Today</p><h1 class="card-title">No lesson ready</h1><p>${detail}</p><button class="button" data-action="retry-learning" type="button">Retry</button></section>`;
}
