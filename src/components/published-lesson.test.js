import { describe, expect, it } from "vitest";
import { publishedLessonSchema, projectPublishedLesson } from "../lesson-contract.js";
import { versionedWordLesson } from "../fixtures/versioned-word-lesson.js";
import { renderPublishedLesson } from "./published-lesson.js";

describe("versioned public lesson contract and renderer", () => {
  it("projects only allowlisted fields, including nested objects", () => {
    const input = structuredClone(versionedWordLesson);
    input.secretMarker = "root private value";
    input.pronunciation.internalLocator = "private pronunciation mapping";
    input.sources[0].rawReply = "private raw reply";
    input.sources[0].license.key = "private key";
    input.meanings[0].provenance = "private generated-field mapping";
    input.meanings[0].usageNotes[0].sourceRecordIds = ["private source meaning"];
    input.meanings[0].synonyms[0].rejection = "private rejection rationale";
    input.meanings[0].practice = { correctSentence: "nested prototype Practice" };
    input.meanings[0].register = "obsolete published field";
    expect(projectPublishedLesson(input)).toEqual(versionedWordLesson);
    expect(input.secretMarker).toBe("root private value");
    expect(renderPublishedLesson({ lesson: input })).not.toContain("private");
    expect(renderPublishedLesson({ lesson: input })).not.toContain("nested prototype Practice");
  });

  it("renders all public fields and licenses with resolvable citations and no Practice controls", () => {
    document.body.innerHTML = renderPublishedLesson({ lesson: versionedWordLesson });
    const article = document.querySelector("article");
    expect(article.dataset.lessonId).toBe("lesson-candid");
    expect(article.dataset.publicationVersion).toBe("1");
    expect(article.textContent).toContain("/ˈkændɪd/");
    expect(article.textContent).toContain("General American");
    expect(document.querySelector("[data-meaning-id]").dataset.meaningId).toBe("meaning-candid-direct");
    expect(document.querySelectorAll(".word-lesson-examples li")).toHaveLength(3);
    expect(article.textContent).toContain(versionedWordLesson.meanings[0].definition);
    expect(article.textContent).toContain(versionedWordLesson.meanings[0].useItWhen);
    expect(article.textContent).toContain(versionedWordLesson.meanings[0].doNotUseItFor);
    expect(document.querySelectorAll(".word-lesson-patterns li")).toHaveLength(2);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(document.querySelector("tbody").textContent).toContain("abruptness");
    expect(document.querySelector("tbody").textContent).toContain("No supported difference");
    expect(document.querySelector(".word-lesson-usage").textContent).toContain(versionedWordLesson.meanings[0].usageNotes[0].text);
    expect(document.querySelector(".word-lesson-origin").textContent).toContain(versionedWordLesson.meanings[0].originNote.text);
    expect(document.querySelector(".word-lesson-etymology").textContent).toContain(versionedWordLesson.etymology.text);
    expect(document.querySelector(".word-lesson-family").textContent).toContain("candor");
    for (const citation of document.querySelectorAll('a[href^="#lesson-source-"]')) expect(document.querySelector(citation.getAttribute("href"))).not.toBeNull();
    for (const source of versionedWordLesson.sources) {
      expect(article.textContent).toContain(source.release);
      for (const text of [...source.credits, ...source.notices, source.changes]) expect(article.textContent).toContain(text);
    }
    expect(document.querySelector('a[href="https://example.test/wiki/candid?oldid=1"]')).not.toBeNull();
    expect(document.querySelector('a[href="https://example.test/wiki/candid?action=history"]')).not.toBeNull();
    expect(article.textContent).toContain("CC BY-SA 4.0");
    expect(document.querySelector('[data-action="practice-answer"]')).toBeNull();
    expect(document.querySelector('[data-action="revise-familiarity"]')).not.toBeNull();
  });

  it("keeps empty optional sections absent while retaining Sources", () => {
    const lesson = structuredClone(versionedWordLesson);
    lesson.etymology = null;
    lesson.wordFamily = [];
    lesson.meanings[0].synonyms = [];
    lesson.meanings[0].usageNotes = [];
    lesson.meanings[0].originNote = null;
    document.body.innerHTML = renderPublishedLesson({ lesson });
    for (const name of ["etymology", "family", "contrasts", "usage", "origin"]) expect(document.querySelector(`.word-lesson-${name}`)).toBeNull();
    expect(document.querySelector(".word-lesson-sources")).not.toBeNull();
    expect(document.body.textContent).not.toContain("undefined");
    expect(document.body.textContent).not.toContain("null");
  });

  it("rejects incomplete, unversioned and forged citation records without a compatibility reader", () => {
    for (const change of [
      lesson => { delete lesson.schemaVersion; },
      lesson => { lesson.schemaVersion = "unknown-version"; },
      lesson => { lesson.meanings[0].examples.pop(); },
      lesson => { lesson.pronunciation.sourceRef = "missing"; },
      lesson => { lesson.meanings[0].usageNotes[0].sourceRefs = ["missing"]; },
      lesson => { lesson.sources[1].historyUrl = null; },
      lesson => { lesson.sources.push(lesson.sources[0]); },
      lesson => { lesson.meanings.push(lesson.meanings[0]); },
      lesson => { lesson.sources[0].url = "javascript:alert(1)"; }
    ]) {
      const lesson = structuredClone(versionedWordLesson);
      change(lesson);
      expect(publishedLessonSchema.safeParse(lesson).success).toBe(false);
      expect(() => renderPublishedLesson({ lesson })).toThrow();
    }
  });

  it("requires null origin notes when source etymology is absent", () => {
    const lesson = structuredClone(versionedWordLesson);
    lesson.etymology = null;
    expect(publishedLessonSchema.safeParse(lesson).success).toBe(false);
    expect(() => renderPublishedLesson({ lesson })).toThrow();
    lesson.meanings[0].originNote = null;
    expect(publishedLessonSchema.safeParse(lesson).success).toBe(true);
    document.body.innerHTML = renderPublishedLesson({ lesson });
    expect(document.querySelector(".word-lesson-origin, .word-lesson-etymology")).toBeNull();
    expect(document.querySelector(".word-lesson-usage")).not.toBeNull();
  });

  it("escapes field text and attributes rather than executing lesson content", () => {
    const lesson = structuredClone(versionedWordLesson);
    lesson.headword = '<img src=x onerror="alert(1)">';
    lesson.meanings[0].definition = "<script>window.leaked = true</script>";
    lesson.meanings[0].id = 'meaning-" onclick="alert(1)';
    lesson.sources[0].name = "<iframe>";
    lesson.sources[0].notices = ["<svg onload=alert(1)>"];
    document.body.innerHTML = renderPublishedLesson({ lesson });
    expect(document.querySelector("img, script, iframe, svg, [onclick], [onerror]")).toBeNull();
    expect(document.querySelector(".word-lesson-definition").textContent).toBe("<script>window.leaked = true</script>");
    expect(document.querySelector("[data-meaning-id]").dataset.meaningId).toBe(lesson.meanings[0].id);
  });

  it("retains stable meaning IDs across reordering and renders every meaning", () => {
    const lesson = structuredClone(versionedWordLesson);
    lesson.meanings.push({ ...structuredClone(lesson.meanings[0]), id: "meaning-candid-photograph", definition: "Synthetic second meaning for ordering checks." });
    lesson.meanings.reverse();
    document.body.innerHTML = renderPublishedLesson({ lesson });
    expect([...document.querySelectorAll("[data-meaning-id]")].map(element => element.dataset.meaningId))
      .toEqual(["meaning-candid-photograph", "meaning-candid-direct"]);
    expect(document.querySelectorAll(".word-lesson-examples li")).toHaveLength(6);
  });
});
