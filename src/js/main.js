import { renderLessonCard } from "../components/card.js";
import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderPractice } from "../components/practice.js";
import { renderStatus } from "../components/status.js";
import { bindNavigation } from "../components/navigation.js";
import { renderProfile, renderRecoveryCompletion } from "../components/profile.js";
import { escapeHtml, renderButton } from "../components/button.js";
import { BrowserWebAuthn } from "../webauthn.js";
import { HttpLearningStateAdapter, LearningStateClient } from "../learning-sync.js";
import { HttpProfileAdapter } from "../profile-api.js";
import { ProfileClient } from "../profile-client.js";
import { createInstallation } from "../install.js";
import { createProductSignals } from "../product-signals.js";
import { renderLearningSyncStatus } from "../components/learning-sync-status.js";

const html = String.raw;
const sessionExpiredDetail = "Your session has expired. Your unsent learning changes are still on this device.";
const retryMinBusyMs = 600;

const main = document.querySelector("#app-main");
const syncStatusOutlet = document.querySelector("#learning-sync-status");
let route = "today";
let familiarity;
let revising = false;
let practiceResult;
let syncStatus;
let syncBusy = false;
let deletionConfirmation = false;
let recoveryVerification;
let recoveryStart;
let handoff;
let deleted = false;
let recoveryToken = new URL(window.location.href).searchParams.get("recover-token");
let handoffCode = new URL(window.location.href).searchParams.get("continue-code");
let analyticsConsent = localStorage.getItem("wordwell:analytics-consent") === "granted";
let installation;
const webauthn = new BrowserWebAuthn();
const profileAdapter = new HttpProfileAdapter({
  baseUrl: document.documentElement.dataset.apiBaseUrl ?? "",
});
let learningStarted = profileAdapterHasSession();
const profileClient = new ProfileClient({ adapter: profileAdapter, webauthn });
let practiceVisit;
const learningAdapter = new HttpLearningStateAdapter({
  baseUrl: document.documentElement.dataset.apiBaseUrl ?? "",
});
const learning = new LearningStateClient({
  server: learningAdapter,
  profile: learningAdapter.cacheKey,
});
const signals = createProductSignals(() => analyticsConsent);
installation = createInstallation({ window, navigator, signals, onChange: () => render() });

void startLearning();
window.addEventListener("online", reconcileLearning);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void reconcileLearning();
});

function render() {
  syncStatusOutlet.innerHTML = renderLearningSyncStatus(syncStatus, { busy: syncBusy });
  if (deleted) {
    main.innerHTML = renderProfile({ profile: { state: "tombstoned" } });
    return;
  }
  if (recoveryToken) {
    main.innerHTML = renderRecoveryCompletion();
    return;
  }
  if (!learningStarted) {
    main.innerHTML = renderWelcome();
    return;
  }
  if (route === "profile") {
    main.innerHTML = renderProfile({
      profile: profileClient.cache(),
      deletionConfirmation,
      recoveryVerification,
      recoveryStart,
      handoff,
      installation: installation.show(),
      analyticsConsent,
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
  if (!delivery || !lesson || !Array.isArray(lesson.meanings) || !lesson.meanings.length || (route !== "practice" && !isToday(delivery))) {
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
    if (route === "history") void profileClient.recordHistoryAccess();
    if (route === "profile") void profileClient.load();
    practiceResult = undefined;
    practiceVisit = undefined;
    render();
    main.focus();
  },
});

document.addEventListener("click", async (event) => {
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
    void reconcileLearning({ source: "retry" });
  } else if (target.dataset.action === "skip-upcoming") {
    void skipUpcoming(target.dataset.value);
  } else if (target.dataset.action === "install-app") {
    void installation.prompt();
  } else if (target.dataset.action === "start-fresh-profile") {
    try {
      await profileAdapter.createAnonymousProfile();
      learningStarted = true;
      await startLearning();
    } catch (error) {
      console.error("anonymous profile creation failed", error);
    }
  } else if (target.dataset.action === "protect-profile") {
    try {
      await profileClient.protect("This device");
    } catch (error) {
      console.error("protect failed", error);
    }
  } else if (target.dataset.action === "sign-in-passkey") {
    try {
      await learning.discard();
      await profileClient.authenticate();
      learningStarted = true;
      await learning.hydrate();
    } catch (error) {
      console.error("passkey sign-in failed", error);
    }
  } else if (target.dataset.action === "create-handoff") {
    try {
      const result = await profileClient.createHandoff();
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("continue-code", result.code);
      handoff = { ...result, url: url.toString() };
    } catch (error) {
      console.error("handoff creation failed", error);
    }
  } else if (target.dataset.action === "add-passkey") {
    try {
      await profileClient.addPasskey("New passkey");
    } catch (error) {
      console.error("addPasskey failed", error);
    }
  } else if (target.dataset.action === "revoke-passkey") {
    try {
      await profileClient.revokePasskey(target.dataset.value);
    } catch (error) {
      console.error("revokePasskey failed", error);
    }
  } else if (target.dataset.action === "verify-recovery-email") {
    try {
      await profileClient.verifyRecoveryEmail(target.dataset.value);
      recoveryVerification = undefined;
    } catch (error) {
      console.error("verifyRecoveryEmail failed", error);
    }
  } else if (target.dataset.action === "complete-profile-recovery") {
    try {
      const result = await profileClient.completeRecovery(recoveryToken, "Recovered passkey");
      if (result.status === "active") {
        recoveryToken = undefined;
        window.history.replaceState({}, "", window.location.pathname);
        await profileClient.load();
        await reconcileLearning();
      }
    } catch (error) {
      console.error("completeRecovery failed", error);
    }
  } else if (target.dataset.action === "start-profile-deletion") {
    deletionConfirmation = true;
  } else if (target.dataset.action === "cancel-profile-deletion") {
    deletionConfirmation = false;
  } else if (target.dataset.action === "confirm-profile-deletion") {
    try {
      await profileClient.deleteProfile();
      deleted = true;
      void reconcileLearning();
    } catch (error) {
      console.error("deleteProfile failed", error);
    }
    deletionConfirmation = false;
  }
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target.closest('[data-action="analytics-consent"]');
  if (!target) return;
  analyticsConsent = target.checked;
  localStorage.setItem("wordwell:analytics-consent", analyticsConsent ? "granted" : "denied");
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-action="add-recovery-email"]');
  if (!form) return;
  event.preventDefault();
  const email = new FormData(form).get("recovery-email");
  try {
    const result = await profileClient.requestRecoveryEmail(String(email));
    recoveryVerification = { email, token: result.token, expiresAt: result.expiresAt };
  } catch (error) {
    console.error("requestRecoveryEmail failed", error);
  }
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-action="redeem-handoff"]');
  if (!form) return;
  event.preventDefault();
  try {
    await learning.discard();
    await profileClient.redeemHandoff(String(new FormData(form).get("continuation-code")));
    learningStarted = true;
    await learning.hydrate();
  } catch (error) {
    console.error("handoff redemption failed", error);
  }
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest('[data-action="start-profile-recovery"]');
  if (!form) return;
  event.preventDefault();
  try {
    const email = String(new FormData(form).get("recovery-start-email"));
    const result = await profileClient.startRecovery(email);
    if (result.status === "active") {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("recover-token", result.token);
      recoveryStart = { url: url.toString() };
    }
  } catch (error) {
    console.error("startRecovery failed", error);
  }
  render();
});

function recordLearning(kind, details) {
  learning.record(kind, details);
  if (navigator.onLine) void reconcileLearning();
  else syncStatus = "offline";
}

async function startLearning() {
  await learning.ready();
  if (handoffCode) {
    try {
      await learning.discard();
      await profileClient.redeemHandoff(handoffCode);
      window.history.replaceState({}, "", window.location.pathname);
      handoffCode = undefined;
      learningStarted = true;
    } catch (error) {
      console.error("handoff redemption failed", error);
    }
  }
  if (!learningStarted) {
    render();
    return;
  }
  await profileClient.load().catch((error) => console.error("profile load failed", error));
  const cached = learning.cache();
  familiarity = currentDelivery(cached)?.familiarity;
  if (!navigator.onLine) syncStatus = "offline";
  render();
  await reconcileLearning();
}

function profileAdapterHasSession() {
  return profileAdapter.hasSession;
}

function renderWelcome() {
  return html`<section class="card flow"><p class="lesson-label">WordWell</p><h1 class="card-title">Continue your learning</h1><p>Use a continuation code or passkey to join an existing profile. Start fresh only when you want a new anonymous profile.</p><form data-action="redeem-handoff"><label for="continuation-code">Continuation code</label><input id="continuation-code" name="continuation-code" autocomplete="one-time-code" required /><button class="button" type="submit">Continue</button></form>${renderButton({ label: "Sign in with a passkey", action: "sign-in-passkey", variant: "outline" })}${renderButton({ label: "Start fresh", action: "start-fresh-profile", variant: "outline" })}</section>`;
}

async function reconcileLearning({ source = "auto" } = {}) {
  if (source !== "retry") {
    await runReconcile();
    return;
  }
  syncBusy = true;
  render();
  let outcome;
  try {
    outcome = await runReconcile({ keepBusy: true });
  } finally {
    const elapsed = outcome?.elapsed ?? 0;
    const remaining = Math.max(0, retryMinBusyMs - elapsed);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    syncBusy = false;
    render();
  }
}

async function runReconcile({ keepBusy = false } = {}) {
  const start = Date.now();
  try {
    const result = await learning.synchronize();
    syncStatus = result.status;
    if (result.status === "deleted") deleted = true;
    if (result.status === "active") {
      familiarity = currentDelivery()?.familiarity;
      practiceVisit = undefined;
    }
  } catch (error) {
    syncStatus = "offline";
  } finally {
    if (!keepBusy) render();
  }
  return { elapsed: Date.now() - start };
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
    ? sessionExpiredDetail
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
