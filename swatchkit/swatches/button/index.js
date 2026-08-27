import { renderButton } from "../../../src/components/button.js";

const html = String.raw;

export default html`
  <h2>Button</h2>
  <p>
    The same <code>renderButton</code> function used by WordWell's lesson,
    Familiarity gate, and practice interaction.
  </p>

  <h3>Variants</h3>
  <div class="cluster gap">
    ${renderButton({ label: "Primary" })}
    ${renderButton({ label: "Outline", variant: "outline" })}
    ${renderButton({ label: "Choose an answer", variant: "choice" })}
  </div>

  <h3>Sizes</h3>
  <div class="cluster gap">
    ${renderButton({ label: "Small", size: "small" })}
    ${renderButton({ label: "Default" })}
    ${renderButton({ label: "Large", size: "large" })}
  </div>

  <h3>As a link</h3>
  ${renderButton({ label: "View brand", href: "#" })}
`;
