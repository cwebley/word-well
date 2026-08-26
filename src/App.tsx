import { useState } from "react";
import { DailyLessons, type Familiarity, type StartingBand } from "./daily-lessons";
import { seededVocabularyRecord } from "./fixtures/published-word-lesson";
import { InstallApp } from "./InstallApp";
import { createProductSignals } from "./product-signals";
import "./styles.css";

export default function App() {
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [dailyLessons] = useState(
    () => new DailyLessons([{ id: "candid", startingBand: "Stretch my vocabulary", record: seededVocabularyRecord }])
  );
  const [startingBand, setStartingBand] = useState<StartingBand>("Stretch my vocabulary");
  const [familiarity, setFamiliarity] = useState<Familiarity>();
  const [showHistory, setShowHistory] = useState(false);
  const signals = createProductSignals(() => analyticsConsent);
  const profileId = "anonymous-learner";
  const delivery = dailyLessons.deliver(profileId, Intl.DateTimeFormat().resolvedOptions().timeZone)!;
  const lesson = familiarity ? dailyLessons.readLesson(profileId, delivery.id) : undefined;
  const meaning = lesson?.meanings[0];

  function chooseBand(band: StartingBand) {
    dailyLessons.setStartingBand(profileId, band);
    setStartingBand(band);
  }

  function recordFamiliarity(value: Familiarity) {
    dailyLessons.recordFamiliarity(profileId, delivery.id, value);
    setFamiliarity(value);
  }

  return (
    <main className="page-shell">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="WordWell home">
          WordWell
        </a>
        <div className="masthead-actions">
          <label className="analytics-consent">
            <input
              type="checkbox"
              checked={analyticsConsent}
              onChange={(event) => setAnalyticsConsent(event.target.checked)}
            />
            Share anonymous product signals
          </label>
          <button type="button" className="history-button" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Today" : "History"}
          </button>
        </div>
      </header>

      {showHistory ? (
        <section className="lesson-card" aria-label="History">
          <p className="eyebrow">History</p>
          {dailyLessons.history(profileId).map((item) => (
            <p key={item.delivery.id}>
              {item.delivery.localDate}: {item.status === "current" ? item.lesson?.headword : "Unavailable lesson"}
            </p>
          ))}
        </section>
      ) : (
        <article className="lesson-card">
          <p className="eyebrow">Today&apos;s word</p>
          <label>
            Starting band
            <select value={startingBand} onChange={(event) => chooseBand(event.target.value as StartingBand)}>
              <option>Build foundations</option>
              <option>Stretch my vocabulary</option>
              <option>Challenge me</option>
            </select>
          </label>

          {!meaning ? (
            <section aria-label="Familiarity">
              <h1>How familiar is this word?</h1>
              {(["Never seen it", "Seen it, unsure", "Know the meaning", "Could use it naturally"] as const).map((value) => (
                <button key={value} type="button" onClick={() => recordFamiliarity(value)}>{value}</button>
              ))}
            </section>
          ) : (
          <>
            <h1>{lesson.headword}</h1>
            <p className="pronunciation">{lesson.pronunciation}</p>
            <section aria-label="Definition">
              <p className="definition">{meaning.definition}</p>
              <p className="example">“{meaning.example}”</p>
            </section>

            <dl className="guidance">
              <div>
                <dt>Use it when</dt>
                <dd>{meaning.useItWhen}</dd>
              </div>
              <div>
                <dt>Don&apos;t use it for</dt>
                <dd>{meaning.doNotUseItFor}</dd>
              </div>
            </dl>

            <p className="synonyms">Also: {meaning.synonyms.join(", ")}</p>
          </>
          )}
        </article>
      )}
      <InstallApp signals={signals} />
    </main>
  );
}
