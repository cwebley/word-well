import { describe, expect, it, vi } from "vitest";
import { renderButton } from "./button.js";
import { renderLessonCard } from "./card.js";
import { renderFamiliarityGate } from "./familiarity.js";
import { renderPractice } from "./practice.js";
import { renderStatus } from "./status.js";
import { bindNavigation, renderNavigation } from "./navigation.js";
import { renderProfile } from "./profile.js";
import {
  multiMeaningVocabularyRecord,
  seededVocabularyRecord,
} from "../fixtures/published-word-lesson.js";

describe("SwatchKit shared WordWell components", () => {
  it("escapes and delegates button actions", () => {
    const html = renderButton({ label: "<Choose>", action: "familiarity", value: "Seen it, unsure", variant: "choice" });

    expect(html).toContain("&lt;Choose&gt;");
    expect(html).toContain('data-action="familiarity"');
  });

  it("renders the learner components shared by the application and library", () => {
    const lesson = renderLessonCard({ lesson: seededVocabularyRecord });
    expect(lesson).toContain("candid");
    expect(lesson).toContain('class="region word-lesson"');
    expect(lesson).toContain('class="region wrapper word-hero"');
    expect(lesson).toContain('class="word-hero-word"');
    expect(lesson).not.toContain('class="word-hero-pinned"');
    expect(lesson).not.toContain('class="card flow"');

    const familiarity = renderFamiliarityGate({ headword: "candid", pronunciation: "/kan-did/", partOfSpeech: "adjective" });
    expect(familiarity).toContain("How familiar is this word?");
    expect(familiarity).toContain('class="region wrapper word-hero"');
    expect(familiarity).toContain('class="word-hero-word"');
    expect(familiarity).not.toContain('class="word-hero-pinned"');
    expect(familiarity).toContain("/kan-did/ · adjective");
    expect(familiarity).toContain("Familiar, but I don&#39;t use it");
    expect(familiarity).toContain('class="familiarity-actions"');
    expect(familiarity).toContain('class="familiarity-gate"');
    expect(familiarity).toContain('class="region wrapper flow familiarity-prompt');
    expect(familiarity).toContain('class="button choice large"');
    expect(lesson).toContain("In a sentence");
    expect(lesson).toContain("He was candid about why the plan had not worked.");
    expect(lesson).toContain("Use it when");
    expect(lesson).toContain("Do not use it for");
    expect(lesson).toContain("Where it comes from");
    expect(lesson).toContain("Useful to me");
    expect(lesson).toContain("I&#39;m using this");
    expect(lesson).toContain("This seems wrong");
    const practice = renderPractice({ practice: seededVocabularyRecord.meanings[0].practice });
    expect(practice).toContain("Which sentence uses candid naturally?");
    expect(practice).toContain('class="button choice large"');
    expect(practice).toContain('class="practice region region-space:space-l"');
    expect(practice).toContain('class="wrapper"');
    expect(practice).not.toContain('class="card practice');
    expect(practice).not.toContain("lesson-label");
    expect(renderPractice({ practice: seededVocabularyRecord.meanings[0].practice, result: false })).not.toContain("Practice again");
    expect(renderStatus({ label: "You're offline", detail: "Downloaded lessons remain available." })).toContain("You&#39;re offline");
  });

  it("renders every meaning in a multi-meaning lesson", () => {
    const lesson = renderLessonCard({ lesson: multiMeaningVocabularyRecord });

    expect(lesson).toContain("honest and direct, even when the truth may be uncomfortable");
    expect(lesson).toContain("shown plainly in a photograph without posing or concealment");
    expect(lesson).toContain("The newspaper printed a candid photo from the event.");
    expect(lesson).toContain('id="lesson-meaning-0"');
    expect(lesson).toContain('id="lesson-meaning-1"');
    expect(lesson).toContain('id="lesson-examples-0"');
    expect(lesson).toContain('id="lesson-examples-1"');
    expect(lesson).toContain("Also: frank, open, unposed, informal");
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

  it("renders anonymous protection, credential management, and deletion confirmation", () => {
    expect(renderProfile({ profile: { state: "anonymous", canProtect: false } })).toContain("Anonymous for now");
    expect(renderProfile({ profile: { state: "anonymous", canProtect: true } })).toContain('data-action="protect-profile"');
    const protectedProfile = renderProfile({ profile: { state: "protected", passkeys: [{ id: "passkey-1", label: "Laptop" }] } });
    expect(protectedProfile).toContain("Recovery email");
    expect(protectedProfile).toContain('data-action="revoke-passkey"');
    expect(renderProfile({ profile: { state: "protected", passkeys: [] }, deletionConfirmation: true })).toContain("Permanently delete profile");
  });

  it("renders platform-appropriate installation help and explicit signal consent", () => {
    const ios = renderProfile({
      profile: { state: "anonymous", canProtect: false },
      installation: { capability: "ios_home_screen", canPrompt: false },
    });
    const chromium = renderProfile({
      profile: { state: "anonymous", canProtect: false },
      installation: { capability: "chromium_prompt", canPrompt: true },
      analyticsConsent: true,
    });

    expect(ios).toContain("Add to Home Screen");
    expect(chromium).toContain('data-action="install-app"');
    expect(chromium).toContain('data-action="analytics-consent" type="checkbox" checked');
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
