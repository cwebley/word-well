import { approved, coverage, firmLabel, inspectionRestricted, type AuthoringCase, type CaseContent, type Workspace } from "./records.js";

export function escapeText(value: unknown): string {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function authoringPage(options: {
  workspace: Workspace; csrf: string; versions: number[]; notice?: string;
  editing?: AuthoringCase; attempted?: Partial<CaseContent>; attemptedSplit?: "development" | "held-out" | null;
  attemptedSplits?: Map<string, "development" | "held-out">;
}): string {
  const { workspace, csrf, versions, editing, attempted } = options;
  const values = attempted ?? editing?.content;
  const totals = coverage(workspace);
  const restricted = inspectionRestricted(workspace);
  const hidden = (id?: string) => `<input type="hidden" name="csrf" value="${escapeText(csrf)}">
    <input type="hidden" name="revision" value="${workspace.revision}">
    ${id ? `<input type="hidden" name="id" value="${escapeText(id)}">` : ""}`;
  const form = (body: string, id?: string) => `<form method="post" action="/action" autocomplete="off">${hidden(id)}${body}</form>`;
  const checked = (value: unknown) => value ? " checked" : "";
  const selected = (value: boolean) => value ? " selected" : "";
  const chosenSplit = options.attemptedSplit !== undefined ? options.attemptedSplit : editing?.split ?? null;
  const unassigned = workspace.cases.filter(row => firmLabel(row.content) && !(approved(row) && row.split)).length;
  const groups = [...new Map(workspace.cases.map(row => [row.content.variantGroup, row.content.headword])).entries()];
  const rows = workspace.cases.map(row => `<article>
    <h3><a href="/case/${row.id}">${escapeText(row.content.headword)}</a></h3>
    <p>Finding: ${escapeText(row.content.finding ?? "unset")}. ${row.content.firm ? "Firm" : "Exploration"}.
      ${approved(row) ? "Owner-approved" : "Not approved"}. Split: ${escapeText(row.split ?? "unassigned")}.</p>
    <p class="private-text">${escapeText(row.content.reason)}</p>
    <p><a href="/case/${row.id}">Edit case</a></p>
    <details><summary>Private provenance and identity</summary>
      <p class="private-text">${escapeText(row.content.provenance)}</p>
      <p>Case ${row.id}. Variant group ${row.content.variantGroup}.</p>
      <p>${restricted.has(row.id) ? "Inspected case or connected inspected variant. Development only, including after regrouping." : "No model answers inspected."}</p>
      ${row.approval ? `<p>Approved ${escapeText(row.approval.approvedAt)} by local owner.</p>` : ""}
    </details>
    ${approved(row) ? "" : firmLabel(row.content)
      ? '<p>Firm label saved before one-step approval. Open Edit case and save to approve it.</p>'
      : '<p>Exploration draft: not in a frozen set. Use Edit case to choose a finding and mark the label firm when you are certain.</p>'}
    ${approved(row) ? `<fieldset class="split"><legend>Split</legend>
      <label><input type="radio" name="split:${row.id}" value="development"${checked((options.attemptedSplits?.get(row.id) ?? row.split) === "development")}> Development</label>
      ${restricted.has(row.id) ? "" : `<label><input type="radio" name="split:${row.id}" value="held-out"${checked((options.attemptedSplits?.get(row.id) ?? row.split) === "held-out")}> Held-out</label>`}</fieldset>` : ""}
  </article>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Private appropriateness authoring</title>
    <style>body{font:17px system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;color:#202020;background:#fafaf6}
    label{display:block;margin:.8rem 0}input:not([type=checkbox]),textarea,select{display:block;max-width:100%;width:36rem;box-sizing:border-box;font:inherit;padding:.4rem}
    textarea{min-height:5rem}button{font:inherit;margin:.6rem 0;padding:.5rem}article,section{border:1px solid #aaa;padding:1rem;margin:1rem 0}
    fieldset.split{border:0;padding:0;margin:.6rem 0}fieldset.split label{display:inline-block;margin:.2rem 1.2rem .2rem 0}
    .private-text{white-space:pre-wrap;overflow-wrap:anywhere}#notice{border:2px solid #555;padding:1rem}a{color:#174a7e}</style></head><body>
    <h1>Private appropriateness authoring</h1>
    <p>Local authoring only. No model calls. These cases never enter lesson generation.</p>
    <p>Private text exists in browser and process memory. This page uses no browser storage or external resources.
      Close the page when finished. Stopping the server does not erase a rendered page.</p>
    ${options.notice ? `<p id="notice" role="status">${escapeText(options.notice)}</p>` : ""}
    <section><h2>Coverage</h2><p id="coverage">Development: ${totals.development.clear} clear, ${totals.development.blocked} blocked.
      Held-out: ${totals.heldOut.clear} clear, ${totals.heldOut.blocked} blocked.</p>
      <p>Target: 20 development and 20 held-out, roughly balanced. Smaller stand-in demonstrations are allowed.</p>
      <p>Exploration drafts: ${totals.exploration}. Firm cases without a split: ${totals.awaitingApproval + totals.awaitingSplit}.</p></section>
    <section><h2>${editing ? "Edit saved case" : "Enter a case"}</h2>
      <p>Saving a firm label approves exactly this content, and choosing a split assigns it in the same save.
        Changing the content clears its split unless you choose one again. Uncertain cases stay outside the scored set as exploration drafts.
        Inspection history also constrains related variants, even after edits. Move related held-out cases to development before recording inspection.</p>
      ${form(`<label>Exact headword <input name="headword" value="${escapeText(values?.headword ?? "")}" maxlength="200" required spellcheck="false"></label>
        <label>Expected finding <select name="finding"><option value="">No finding selected</option>
          <option value="clear"${selected(values?.finding === "clear")}>Clear</option>
          <option value="blocked"${selected(values?.finding === "blocked")}>Blocked</option></select></label>
        <label>Short reason, optional <textarea name="reason" maxlength="2000" spellcheck="false" aria-describedby="reason-help">${escapeText(values?.reason ?? "")}</textarea></label>
        <p id="reason-help">Optional private note about your finding. You can save and freeze without one.</p>
        <label><input type="checkbox" name="firm"${checked(values ? values.firm : true)}> This is a firm owner label. Leave unchecked for exploration.</label>
        <label>Private nomination or source provenance, optional <textarea name="provenance" maxlength="4000" spellcheck="false">${escapeText(values?.provenance ?? "")}</textarea></label>
        <label>Close spelling variants <select name="variantGroup"><option value="">New independent group</option>
          ${groups.map(([id, word]) => `<option value="${id}"${selected(values?.variantGroup === id)}>${escapeText(word)}</option>`).join("")}</select></label>
        <p>Choose an existing group for close variants. Normalized variants are checked automatically, including case, punctuation, and accents.</p>
        <label><input type="checkbox" name="answersInspected"${checked(values?.answersInspected)}> I have already inspected model answers for this case. It can only enter development.</label>
        <fieldset class="split"><legend>Split (firm labels only)</legend>
          <label><input type="radio" name="split" value="development"${checked(chosenSplit === "development")}> Development</label>
          ${editing && restricted.has(editing.id) ? "" : `<label><input type="radio" name="split" value="held-out"${checked(chosenSplit === "held-out")}> Held-out</label>`}
          <label><input type="radio" name="split" value=""${checked(!chosenSplit)}> Not yet</label></fieldset>
        <button name="action" value="save">${editing ? "Save case changes" : "Save case"}</button>`, editing?.id)}
      ${editing ? '<p><a href="/">Enter another case</a></p>' : ""}
    </section>
    <section><h2>Saved cases</h2>${rows ? form(`<p>Change any number of splits below, then save once.</p>
      <button name="action" value="splits">Save split changes</button>${rows}
      <button name="action" value="splits">Save split changes</button>`) : "<p>No saved cases.</p>"}</section>
    <section><h2>Freeze an immutable dataset</h2>
      <p>Freezing includes only firm owner-approved cases with assigned splits. Exploration, unapproved, and unassigned cases are excluded.
        The current coverage above is the scored membership. Existing versions cannot be replaced.</p>
      <p>Existing versions: ${versions.length ? versions.join(", ") : "none"}.</p>
      ${unassigned ? `<p id="unassigned"><strong>${unassigned} firm ${unassigned === 1 ? "case has" : "cases have"} no split</strong> and would be left out. Assign ${unassigned === 1 ? "it" : "them"} above, or confirm below.</p>` : ""}
      ${form(`<label>New dataset version <input name="version" type="number" min="1" max="999999" value="${Math.max(0, ...versions) + 1}" required></label>
        ${unassigned ? `<label><input type="checkbox" name="omitUnassigned"> Leave out the ${unassigned} firm ${unassigned === 1 ? "case" : "cases"} without a split.</label>` : ""}
        <label><input type="checkbox" name="confirmFreeze" required> I reviewed the scored membership and want to freeze it.</label>
        <button name="action" value="freeze">Freeze encrypted dataset</button>`)}
    </section></body></html>`;
}
