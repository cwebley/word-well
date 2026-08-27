import { describe, expect, it, vi } from "vitest";
import { renderButton } from "./button.js";
import { renderLessonCard } from "./card.js";
import { renderFamiliarityGate } from "./familiarity.js";
import { renderPractice } from "./practice.js";
import { renderStatus } from "./status.js";
import { bindNavigation, renderNavigation } from "./navigation.js";
import { seededVocabularyRecord } from "../fixtures/published-word-lesson.js";

describe("SwatchKit shared WordWell components", () => {
  it("escapes and delegates button actions", () => {
    const html = renderButton({ label: "<Choose>", action: "familiarity", value: "Seen it, unsure", variant: "choice" });

    expect(html).toContain("&lt;Choose&gt;");
    expect(html).toContain('data-action="familiarity"');
  });

  it("renders the learner components shared by the application and library", () => {
    const lesson = renderLessonCard({ lesson: seededVocabularyRecord });
    expect(lesson).toContain("candid");
    expect(lesson).toContain('class="lesson flow"');
    expect(lesson).not.toContain('class="card flow"');
    const familiarity = renderFamiliarityGate({ headword: "candid", pronunciation: "/kan-did/", partOfSpeech: "adjective" });
    expect(familiarity).toContain("How familiar is this word?");
    expect(familiarity).toContain("adjective &middot; /kan-did/");
    expect(familiarity).toContain('class="familiarity-word">candid');
    expect(familiarity).toContain("Familiar, but I don&#39;t use it");
    expect(familiarity).toContain('class="familiarity-actions"');
    expect(familiarity).toContain('class="familiarity-gate"');
    expect(familiarity).toContain('class="familiarity-word-panel"');
    expect(familiarity).toContain('class="familiarity-prompt flow"');
    expect(familiarity).toContain('class="button"');
    expect(familiarity).not.toContain('class="button choice"');
    expect(renderPractice({ practice: seededVocabularyRecord.meanings[0].practice })).toContain("Which sentence uses candid naturally?");
    expect(renderStatus({ label: "You're offline", detail: "Downloaded lessons remain available." })).toContain("You&#39;re offline");
  });

  it("renders navigation with an active page", () => {
    const html = renderNavigation({ current: "practice" });

    expect(html).toContain("navigation-rail");
    expect(html).toContain('class="navigation-wordmark"');
    expect(html).not.toContain("<h1>");
    expect(html).toContain("<h2>");
    expect(html).toContain('href="#practice"');
    expect(html).toContain('data-route="practice" aria-current="page"');
    expect(html).not.toContain('data-route="today" aria-current="page"');
  });

  it("moves aria-current inside a view transition when a navigation link is clicked", () => {
    document.body.innerHTML = renderNavigation();
    const navigation = document.querySelector(".navigation");
    const onNavigate = vi.fn();
    const startViewTransition = vi.fn((update) => update());
    document.startViewTransition = startViewTransition;
    bindNavigation(navigation, { onNavigate });

    document.querySelector('[data-route="history"]').click();

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith("history");
    expect(document.querySelector('[data-route="history"]').getAttribute("aria-current")).toBe("page");
    expect(document.querySelector('[data-route="today"]').getAttribute("aria-current")).toBeNull();
    delete document.startViewTransition;
  });

  it("loads navigation behavior in the SwatchKit preview", async () => {
    const swatch = await import("../../swatchkit/swatches/navigation/index.js");

    expect(swatch.default).toContain('src="../../../../js/navigation-preview.js"');
    expect(swatch.default).toContain("Desktop rail");
    expect(swatch.default).toContain("Compact bottom navigation");
  });
});
