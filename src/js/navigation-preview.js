import { bindNavigation } from "../components/navigation.js";
import { renderLearningSyncStatus } from "../components/learning-sync-status.js";

document.querySelectorAll(".navigation").forEach((navigation) => bindNavigation(navigation));

document.querySelectorAll("[data-sync-preview]").forEach((preview) => {
  const outlet = preview.querySelector(".learning-sync-status");
  const controls = preview.parentElement?.querySelector(".navigation-sync-controls");
  controls?.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="preview-sync-status"]');
    if (!button) return;
    outlet.innerHTML = renderLearningSyncStatus(button.dataset.value);
  });
});
