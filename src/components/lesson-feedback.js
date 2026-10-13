import { renderButton } from "./button.js";

export function renderLessonFeedback() {
  return `<div class="word-feedback flow">
    <p>How is this word landing?</p>
    <div class="word-feedback-actions">
      ${renderButton({ label: "Useful to me", action: "utility", value: "useful", variant: "outline", size: "small" })}
      ${renderButton({ label: "Not useful to me", action: "utility", value: "not_useful", variant: "outline", size: "small" })}
      ${renderButton({ label: "I'm using this", action: "active-use", value: "using", variant: "outline", size: "small" })}
      ${renderButton({ label: "Not using it yet", action: "active-use", value: "not_using", variant: "outline", size: "small" })}
      ${renderButton({ label: "This seems wrong", action: "content-quality", variant: "outline", size: "small" })}
    </div>
  </div>
  ${renderButton({ label: "Update familiarity", action: "revise-familiarity", variant: "outline", size: "small" })}`;
}
