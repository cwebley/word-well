import { renderLessonCard } from "../components/card.js";
import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderPractice } from "../components/practice.js";
import { renderStatus } from "../components/status.js";
import { bindNavigation } from "../components/navigation.js";
import { seededVocabularyRecord } from "../fixtures/published-word-lesson.js";

const html = String.raw;

const main = document.querySelector("#app-main");
let route = "today";
let familiarity;
let revising = false;
let practiceResult;

function render() {
  const lesson = seededVocabularyRecord;
  if (route === "practice") {
    main.innerHTML = familiarity ? renderPractice({ practice: lesson.meanings[0].practice, result: practiceResult }) : renderStatus({ label: "Practice", detail: "Record your familiarity before beginning practice." });
  } else if (route === "history") {
    main.innerHTML = familiarity ? html`<section class="card flow"><p class="lesson-label">History</p><h1 class="card-title">Words you've met</h1><p><strong>${lesson.headword}</strong> · ${familiarity}</p></section>` : renderStatus({ label: "History", detail: "Your word history will gather here after today's lesson." });
  } else if (route === "profile") {
    main.innerHTML = html`<section class="card flow"><p class="lesson-label">Your WordWell</p><h1 class="card-title">Keep your learning private and portable.</h1><p>Starting band: Stretch my vocabulary.</p></section>`;
  } else if (!familiarity || revising) {
    main.innerHTML = renderFamiliarityGate({ headword: lesson.headword, pronunciation: lesson.pronunciation, partOfSpeech: lesson.meanings[0].partOfSpeech, revision: revising });
  } else {
    main.innerHTML = renderLessonCard({ lesson });
  }
}

bindNavigation(document.querySelector(".navigation"), {
  onNavigate(nextRoute) {
    route = nextRoute;
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
  }
  render();
});
