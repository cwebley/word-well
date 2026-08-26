import { seededWordLesson } from "./fixtures/published-word-lesson";
import "./styles.css";

export default function App() {
  const [meaning] = seededWordLesson.meanings;

  return (
    <main className="page-shell">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="WordWell home">
          WordWell
        </a>
        <span>Today</span>
      </header>

      <article className="lesson-card">
        <p className="eyebrow">Today&apos;s word</p>
        <h1>{seededWordLesson.headword}</h1>
        <p className="pronunciation">{seededWordLesson.pronunciation}</p>

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

        <p className="synonyms">
          Also: {meaning.synonyms.join(", ")}
        </p>
      </article>
    </main>
  );
}
