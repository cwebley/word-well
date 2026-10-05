import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { PrivateError } from "../../pipeline/storage/crypto.js";
import { authoringPage } from "./page.js";
import { opaqueId, type AuthoringCase, type CaseContent } from "./records.js";
import { type AuthoringCommand, type AuthoringStore } from "./store.js";

// Fixed messages only. Never render raw validation issues or submitted values in errors.
const validationMessages: Record<string, string> = {
  firm_finding_required: "Draft not saved. Choose an expected finding for a firm owner label, then save again.",
  firm_label_required: "Case not approved. Edit the case, choose a finding, mark the label firm, and save before approving.",
  case_invalid: "Draft not saved. Check the headword, finding, and field lengths, then save again."
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
      if (request.method === "POST" && request.url === "/action") {
        if (request.headers.origin !== origin) return deny(403, "origin_rejected");
        const fields = await formData(request);
        if (!equal(fields.get("csrf") ?? "", csrf)) return deny(403, "session_required");
        const revision = Number(fields.get("revision"));
        const id = fields.get("id") || undefined;
        if (id && !opaqueId.safeParse(id).success) return deny(400, "request_invalid");
        let command: AuthoringCommand;
        switch (fields.get("action")) {
          case "save": {
            const group = fields.get("variantGroup") || randomUUID();
            if (!opaqueId.safeParse(group).success) return deny(400, "request_invalid");
            attempted = {
              headword: fields.get("headword") ?? "", finding: fields.get("finding") === "" ? null : fields.get("finding") as CaseContent["finding"],
              reason: fields.get("reason") ?? "", firm: fields.has("firm"), provenance: fields.get("provenance") ?? "",
              variantGroup: group, answersInspected: fields.has("answersInspected")
            };
            command = { action: "save", revision, id, content: attempted }; break;
          }
          case "approve":
            if (!id) return deny(400, "request_invalid");
            command = { action: "approve", revision, id }; break;
          case "split":
            if (!id || !["development", "held-out"].includes(fields.get("split") ?? "")) return deny(400, "request_invalid");
            command = { action: "split", revision, id, split: fields.get("split") as "development" | "held-out", beforeInspection: fields.has("beforeInspection") }; break;
          case "freeze":
            if (!fields.has("confirmFreeze")) return deny(400, "freeze_confirmation_required");
            command = { action: "freeze", revision, version: Number(fields.get("version")) }; break;
          default: return deny(400, "request_invalid");
        }
        try {
          const result = await store.execute(command);
          notice = command.action === "freeze" ? `Encrypted dataset version ${result.manifest!.version} frozen.` :
            command.action === "approve" ? "Owner approval saved encrypted." :
            command.action === "split" ? "Split assignment saved encrypted." : "Draft saved encrypted. Approval is separate.";
          attempted = undefined;
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
      response.end(authoringPage({ workspace: await store.load(), versions: await store.versions(), csrf, notice, editing, attempted }));
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
