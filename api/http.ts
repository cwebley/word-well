import type { IncomingMessage, ServerResponse } from "node:http";
import { ApiError, validateOperations } from "./database.js";
import type { LearnerDatabase } from "./database.js";

export function createApi(database: LearnerDatabase) {
  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      setCorsHeaders(request, response);
      if (request.method === "OPTIONS") return send(response, 204, null);
      const path = new URL(request.url ?? "/", "http://wordwell.local").pathname;
      if (request.method === "POST" && path === "/profiles/anonymous") {
        const clientContextId = request.headers["x-client-context"];
        return send(response, 201, await database.createAnonymousProfile(typeof clientContextId === "string" ? clientContextId : undefined, clientTimeZone(request) ?? "UTC"));
      }
      if (request.method === "POST" && path === "/product-signals") {
        const signal = productSignal(await readJson(request));
        await database.recordProductSignal(signal);
        return send(response, 204, null);
      }

      const grant = bearerGrant(request);
      if (request.method === "GET" && path === "/learning-state") {
        return sendRepository(response, await database.readState(grant, clientTimeZone(request)));
      }
      if (request.method === "POST" && path === "/learning-state/sync") {
        const body = await readJson(request);
        const operations = validateOperations(body && typeof body === "object" ? (body as Record<string, unknown>).operations : undefined);
        return sendRepository(response, await database.synchronize(grant, operations, clientTimeZone(request)));
      }
      if (request.method === "POST" && path === "/session/renew") {
        return sendRepository(response, await database.renewSession(grant));
      }
      const skip = path.match(/^\/upcoming\/([^/]+)\/skip$/);
      if (request.method === "POST" && skip) {
        return sendRepository(response, await database.skipUpcoming(grant, decodeURIComponent(skip[1]!), clientTimeZone(request)));
      }
      send(response, 404, { error: "Not found." });
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 401) return send(response, 401, { status: "session-expired" });
      send(response, status, { error: status === 500 ? "Unexpected server error." : error instanceof Error ? error.message : "Request was rejected." });
    }
  };
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
  }
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type, x-client-context, x-time-zone");
}

function sendRepository(response: ServerResponse, value: { status: string; [key: string]: unknown }): void {
  const statusCode = value.status === "deleted" ? 410 : value.status === "session-expired" ? 401 : 200;
  send(response, statusCode, value);
}

function send(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function bearerGrant(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ") || header.length <= "Bearer ".length) throw new ApiError(401, "A session grant is required.");
  return header.slice("Bearer ".length);
}

function clientTimeZone(request: IncomingMessage): string | undefined {
  const value = request.headers["x-time-zone"];
  return typeof value === "string" && value ? value : undefined;
}

function productSignal(value: unknown): {
  event: "install_cta_shown" | "install_cta_started" | "install_confirmed";
  capability: "chromium_prompt" | "ios_home_screen";
  day: string;
} {
  if (!value || typeof value !== "object") throw new ApiError(400, "A product signal is required.");
  const { event, capability, day } = value as Record<string, unknown>;
  if (
    !["install_cta_shown", "install_cta_started", "install_confirmed"].includes(String(event)) ||
    !["chromium_prompt", "ios_home_screen"].includes(String(capability)) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(day))
  ) {
    throw new ApiError(400, "Product signal was not valid.");
  }
  return { event: event as "install_cta_shown" | "install_cta_started" | "install_confirmed", capability: capability as "chromium_prompt" | "ios_home_screen", day: String(day) };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1024 * 1024) throw new ApiError(413, "Request body is too large.");
    chunks.push(buffer);
  }
  if (!length) throw new ApiError(400, "A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Request body was not valid JSON.");
  }
}
