import { renderLessonCard } from "../components/card.js";
import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderPractice } from "../components/practice.js";
import { renderStatus } from "../components/status.js";
import { bindNavigation } from "../components/navigation.js";
import { renderProfile } from "../components/profile.js";
import { escapeHtml, renderButton } from "../components/button.js";
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
  if (route === "history") {
    main.innerHTML = renderHistory();
    return;
  }
  const cachedDelivery = currentDelivery();
  const delivery = route === "practice" ? cachedDelivery : todayDelivery();
  const lesson = currentLesson(delivery);
  if (!delivery || !lesson || (route !== "practice" && !isToday(delivery))) {
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
  } else if (!familiarity || revising) {
    main.innerHTML = renderFamiliarityGate({
      headword: lesson.headword,
      pronunciation: lesson.pronunciation,
      partOfSpeech: lesson.meanings[0].partOfSpeech,
      revision: revising,
    }) + renderUpcoming();
  } else {
    main.innerHTML = renderLessonCard({ lesson }) + renderUpcoming();
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
  } else if (target.dataset.action === "skip-upcoming") {
    void skipUpcoming(target.dataset.value);
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
  if (!navigator.onLine) syncStatus = "offline";
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

async function skipUpcoming(upcomingId) {
  if (!upcomingId) return;
  try {
    const result = await learning.skipUpcoming(upcomingId);
    syncStatus = result.status;
  } catch {
    syncStatus = "offline";
  }
  render();
}

function currentDelivery(cached = learning.cache()) {
  return cached.delivery ?? cached.history.find(({ status }) => status === "current");
}

function todayDelivery(cached = learning.cache()) {
  const delivery = currentDelivery(cached);
  return delivery && isToday(delivery) ? delivery : undefined;
}

function isToday(delivery) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return delivery.localDate === `${values.year}-${values.month}-${values.day}`;
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
      ? currentDelivery() && !isToday(currentDelivery())
        ? "Your next daily delivery needs a connection. Cached history and practice remain available."
        : "Your saved lessons are unavailable right now. Retry when you are connected."
      : "Your next lesson will appear here after it is delivered.";
  return html`<section class="card flow"><p class="lesson-label">Today</p><h1 class="card-title">No lesson ready</h1><p>${detail}</p><button class="button" data-action="retry-learning" type="button">Retry</button></section>`;
}

function renderHistory() {
  const history = learning.cache().history;
  if (!history.length) {
    return renderStatus({
      label: "History",
      detail: "Your word history will gather here after today's lesson.",
    });
  }
  const entries = history.map((delivery) => {
    const lesson = currentLesson(delivery);
    const label = lesson?.headword ?? delivery.normalizedHeadword;
    const familiarityLabel = delivery.status === "current" ? delivery.familiarity ?? "Not started" : "Unavailable";
    return html`<li><strong>${escapeHtml(label)}</strong> · ${escapeHtml(delivery.localDate)} · ${escapeHtml(familiarityLabel)}</li>`;
  }).join("");
  return html`<section class="card flow">
    <p class="lesson-label">History</p>
    <h1 class="card-title">Words you've met</h1>
    <ol role="list">${entries}</ol>
  </section>`;
}

function renderUpcoming() {
  const upcoming = learning.cache().upcoming?.slice(0, 3) ?? [];
  if (!upcoming.length) return "";
  const words = upcoming.map((item) => html`<li class="card flow">
    <strong>${escapeHtml(item.headword ?? item.normalizedHeadword)}</strong>
    ${navigator.onLine ? renderButton({ label: "Skip", action: "skip-upcoming", value: item.id, variant: "outline", size: "small" }) : ""}
  </li>`).join("");
  return html`<section class="region wrapper flow" aria-labelledby="up-next-heading">
    <p class="lesson-label">Up next</p>
    <h2 id="up-next-heading">Words waiting for another day</h2>
    <ol role="list">${words}</ol>
  </section>`;
}
