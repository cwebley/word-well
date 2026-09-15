import { renderWordHero } from "../../../src/components/word-hero.js";

const html = String.raw;

export default html`
  <h2>Word hero</h2>
  <p>
    The pinned-to-top headword panel shared by the familiarity gate and the
    word lesson reading page. It renders a sticky bar above the hero so
    scrolling the hero naturally uncovers the word pinned to the top.
  </p>
  <div class="word-hero-preview">
    ${renderWordHero({
      headword: "candid",
      pronunciation: "/ˈkændɪd/",
      partOfSpeech: "adjective",
    })}
  </div>
  <style>
    .word-hero-preview {
      container: app-shell / inline-size;
    }
  </style>
`;
