import { renderLessonCard } from "../components/card.js";
import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderPractice } from "../components/practice.js";
import { renderStatus } from "../components/status.js";
import { bindNavigation } from "../components/navigation.js";
import { renderProfile } from "../components/profile.js";
import { seededVocabularyRecord } from "../fixtures/published-word-lesson.js";
import { Profiles } from "../profiles.js";
import { WebAuthnSimulator } from "../webauthn-simulator.js";

const html = String.raw;

const main = document.querySelector("#app-main");
let route = "today";
let familiarity;
let revising = false;
let practiceResult;
let deletionConfirmation = false;
let recoveryVerification;
let deleted = false;
const webauthn = new WebAuthnSimulator();
const profiles = new Profiles({ webauthn });
const profileSession = profiles.createAnonymousProfile().session;

function render() {
  if (deleted) {
    main.innerHTML = renderProfile({ profile: { state: "tombstoned" } });
    return;
  }
  const lesson = seededVocabularyRecord;
  if (route === "practice") {
    main.innerHTML = familiarity ? renderPractice({ practice: lesson.meanings[0].practice, result: practiceResult }) : renderStatus({ label: "Practice", detail: "Record your familiarity before beginning practice." });
  } else if (route === "history") {
    main.innerHTML = familiarity ? html`<section class="card flow"><p class="lesson-label">History</p><h1 class="card-title">Words you've met</h1><p><strong>${lesson.headword}</strong> · ${familiarity}</p></section>` : renderStatus({ label: "History", detail: "Your word history will gather here after today's lesson." });
  } else if (route === "profile") {
    main.innerHTML = renderProfile({ profile: profiles.profile(profileSession.id), deletionConfirmation, recoveryVerification });
  } else if (!familiarity || revising) {
    main.innerHTML = renderFamiliarityGate({ headword: lesson.headword, pronunciation: lesson.pronunciation, partOfSpeech: lesson.meanings[0].partOfSpeech, revision: revising });
  } else {
    main.innerHTML = renderLessonCard({ lesson });
  }
}

bindNavigation(document.querySelector(".navigation"), {
  onNavigate(nextRoute) {
    route = nextRoute;
    if (route === "history") profiles.accessHistory(profileSession.id);
    practiceResult = undefined;
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
    revising = false;
  } else if (target.dataset.action === "revise-familiarity") {
    revising = true;
  } else if (target.dataset.action === "practice-answer") {
    practiceResult = target.dataset.value === "correct";
  } else if (target.dataset.action === "practice-reset") {
    practiceResult = undefined;
  } else if (target.dataset.action === "protect-profile") {
    profiles.protect(profileSession.id, webauthn.createPasskey("This device"));
  } else if (target.dataset.action === "add-passkey") {
    authenticateProfile();
    profiles.addPasskey(profileSession.id, webauthn.createPasskey("New passkey"));
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
    deletionConfirmation = false;
    deleted = true;
  }
  render();
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest('[data-action="add-recovery-email"]');
  if (!form) return;
  event.preventDefault();
  const email = new FormData(form).get("recovery-email");
  authenticateProfile();
  recoveryVerification = { email, ...profiles.requestRecoveryEmail(profileSession.id, email) };
  render();
});

function authenticateProfile() {
  const [passkey] = profiles.profile(profileSession.id).passkeys;
  profiles.authenticate(profileSession.id, webauthn.getPasskey(passkey.id));
}
