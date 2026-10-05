import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PrivateError } from "../../pipeline/storage/crypto.js";
import { authoringPage } from "./page.js";
import { opaqueId, type AuthoringCase, type CaseContent } from "./records.js";
import { type AuthoringCommand, type AuthoringStore } from "./store.js";

// Fixed messages only. Never render raw validation issues or submitted values in errors.
const validationMessages: Record<string, string> = {
  firm_finding_required: "Draft not saved. Choose an expected finding for a firm owner label, then save again.",
  firm_label_required: "Not saved. Only a firm label with a finding can have a split. Mark the label firm, or choose Not yet.",
  firm_cases_unassigned: "Not frozen. Some firm cases have no split. Assign them, or tick the box to leave them out.",
  heldout_inspected: "Not saved. A case whose model answers you inspected can only enter development.",
  case_invalid: "Draft not saved. Check the headword, finding, and field lengths, then save again.",
  heldout_inspected_variant: "Not saved. This word or a connected spelling variant has inspected model answers, so it can only enter development.",
  variant_split_conflict: "Not saved. Connected spelling variants must stay on the same side of the split."
};

function equal(value: string, expected: string): boolean {
  const left = Buffer.from(value); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function formData(request: IncomingMessage): Promise<URLSearchParams> {
  if (request.headers["content-type"] !== "application/x-www-form-urlencoded") throw new PrivateError("request_invalid");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new PrivateError("request_too_large");
    chunks.push(chunk);
  }
  const fields = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  if ([...fields.keys()].some(key => fields.getAll(key).length !== 1)) throw new PrivateError("request_invalid");
  return fields;
}

export async function startAuthoringServer(store: AuthoringStore, port = 0) {
  const session = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  let origin = "";
  const headers = (response: ServerResponse) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    // no-referrer makes Chromium send Origin: null on native form POSTs.
    // same-origin keeps external referrers empty and permits the Origin check.
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  };
  const server = createServer(async (request, response) => {
    headers(response);
    const deny = (status: number, code: string) => { response.statusCode = status; response.end(code); };
    try {
      if (request.headers.host !== new URL(origin).host) return deny(403, "session_required");
      const site = request.headers["sec-fetch-site"];
      if (site && !["none", "same-origin"].includes(String(site))) return deny(403, "session_required");
      if (request.method === "GET" && equal(request.url ?? "", `/session/${session}`)) {
        response.setHeader("Set-Cookie", `ww-authoring=${session}; HttpOnly; SameSite=Strict; Path=/`);
        response.statusCode = 303; response.setHeader("Location", "/"); response.end(); return;
      }
      const cookie = request.headers.cookie?.split("; ").find(part => part.startsWith("ww-authoring="))?.slice(13) ?? "";
      if (!equal(cookie, session)) return deny(403, "session_required");
      let notice: string | undefined;
      let editing: AuthoringCase | undefined;
      let attempted: Partial<CaseContent> | undefined;
      let attemptedSplit: "development" | "held-out" | null | undefined;
      // Unsaved batch selections are shown again if the batch is rejected.
      let attemptedSplits: Map<string, "development" | "held-out"> | undefined;
      if (request.method === "POST" && request.url === "/action") {
        if (request.headers.origin !== origin) return deny(403, "origin_rejected");
        const fields = await formData(request);
        if (!equal(fields.get("csrf") ?? "", csrf)) return deny(403, "session_required");
        const revision = Number(fields.get("revision"));
        const id = fields.get("id") || undefined;
        if (id && !opaqueId.safeParse(id).success) return deny(400, "request_invalid");
        let command: AuthoringCommand | undefined;
        switch (fields.get("action")) {
          case "save": {
            const group = fields.get("variantGroup") || randomUUID();
            if (!opaqueId.safeParse(group).success) return deny(400, "request_invalid");
            attempted = {
              headword: fields.get("headword") ?? "", finding: fields.get("finding") === "" ? null : fields.get("finding") as CaseContent["finding"],
              reason: fields.get("reason") ?? "", firm: fields.has("firm"), provenance: fields.get("provenance") ?? "",
              variantGroup: group, answersInspected: fields.has("answersInspected")
            };
            const split = fields.get("split") ?? "";
            if (!["", "development", "held-out"].includes(split)) return deny(400, "request_invalid");
            // Unticking "firm" turns the case back into a draft, so its split is dropped.
            attemptedSplit = split === "" || !attempted.firm ? null : split as "development" | "held-out";
            command = { action: "save", revision, id, content: attempted, split: attemptedSplit }; break;
          }
          case "splits": {
            // Only radios that differ from the saved split become moves.
            const current = new Map((await store.load()).cases.map(row => [row.id, row.split]));
            const assignments: { id: string; split: "development" | "held-out" }[] = [];
            for (const [key, value] of fields) {
              if (!key.startsWith("split:")) continue;
              const caseId = key.slice(6);
              if (!opaqueId.safeParse(caseId).success || !["development", "held-out"].includes(value)) return deny(400, "request_invalid");
              if (current.get(caseId) !== value) assignments.push({ id: caseId, split: value as "development" | "held-out" });
            }
            if (!assignments.length) { notice = "No split changes to save."; break; }
            attemptedSplits = new Map(assignments.map(item => [item.id, item.split]));
            command = { action: "splits", revision, assignments }; break;
          }
          case "freeze":
            if (!fields.has("confirmFreeze")) return deny(400, "freeze_confirmation_required");
            command = { action: "freeze", revision, version: Number(fields.get("version")), omitUnassigned: fields.has("omitUnassigned") }; break;
          default: return deny(400, "request_invalid");
        }
        if (command) try {
          const result = await store.execute(command);
          notice = command.action === "freeze" ? `Encrypted dataset version ${result.manifest!.version} frozen.` :
            command.action === "splits" ? `Saved ${command.assignments.length} split ${command.assignments.length === 1 ? "change" : "changes"}.` :
            command.split ? `Case saved encrypted and assigned to ${command.split}.` :
            (command.content as CaseContent).firm ? "Case saved encrypted. Choose a split before freezing." : "Exploration draft saved encrypted.";
          attempted = undefined; attemptedSplit = undefined; attemptedSplits = undefined;
        } catch (error) {
          response.statusCode = 409;
          const code = error instanceof PrivateError ? error.code : "operation_failed";
          notice = validationMessages[code] ?? `Not confirmed saved. ${code}. Review current saved state before retrying.`;
          if (id) editing = (await store.load()).cases.find(row => row.id === id);
        }
      } else if (request.method === "GET") {
        if (request.url !== "/") {
          const match = /^\/case\/([0-9a-f-]+)$/.exec(request.url ?? "");
          if (!match || !opaqueId.safeParse(match[1]).success) return deny(404, "not_found");
          editing = (await store.load()).cases.find(row => row.id === match[1]);
          if (!editing) return deny(404, "not_found");
        }
      } else return deny(405, "method_rejected");
      response.end(authoringPage({ workspace: await store.load(), versions: await store.versions(), csrf, notice, editing, attempted, attemptedSplit, attemptedSplits }));
    } catch (error) {
      // No exception object or request payload leaves the process.
      deny(503, error instanceof PrivateError ? error.code : "operation_failed");
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new PrivateError("server_unavailable")));
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new PrivateError("server_unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/session/${session}`,
    origin,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(new PrivateError("server_unavailable")) : resolve());
        server.closeAllConnections();
      });
    }
  };
}
