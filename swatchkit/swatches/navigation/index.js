import { renderNavigation } from "../../../src/components/navigation.js";

const html = String.raw;

export default html`
  <h2>Navigation</h2>
  <p>
    The same <code>renderNavigation</code> function used by WordWell's
    application shell.
  </p>

  <h3>Desktop rail</h3>
  <div class="navigation-preview-stage">
    <div class="app-shell navigation-preview navigation-preview--desktop">
      ${renderNavigation()}
      <div class="navigation-preview-main flow">
        <p class="lesson-label">Today's word</p>
        <p>Desktop learner content fills the space beside the navigation rail.</p>
      </div>
    </div>
  </div>

  <h3>Compact bottom navigation</h3>
  <div class="navigation-preview-stage">
    <div class="app-shell navigation-preview navigation-preview--compact">
      ${renderNavigation()}
      <div class="navigation-preview-main flow">
        <p class="lesson-label">Today's word</p>
        <p>Compact learner content leaves room for bottom navigation.</p>
      </div>
    </div>
  </div>

  <style>
    .navigation-preview-stage {
      overflow-x: auto;
    }

    .navigation-preview {
      min-block-size: 20rem;
      outline: var(--stroke);
    }

    .navigation-preview--desktop {
      grid-template-areas: "navigation main";
      grid-template-columns: 16rem minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr);
      inline-size: 50rem;
    }

    .navigation-preview--compact {
      grid-template-areas:
        "main"
        "navigation";
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      inline-size: min(100%, 49.99rem);
    }

    .navigation-preview-main {
      align-content: center;
      background: var(--color-surface);
      grid-area: main;
      padding: var(--space-xl);
    }

    .navigation-preview .navigation-rail {
      grid-area: navigation;
    }

    .navigation-preview .navigation-link[aria-current="page"]::before {
      view-transition-name: none;
    }
  </style>
  <script type="module" src="../../../../js/navigation-preview.js"></script>
`;
