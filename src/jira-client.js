import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: resolve(__dirname, "../.env")});

// Tolerate MCP client configs that pass literal quotes or a trailing slash:
// "https://host/" would build "//rest/..." and Jira answers 404 "null for uri".
export const JIRA_HOST = (process.env.JIRA_HOST ?? "")
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/\/+$/, "");
const BASE = `${JIRA_HOST}/rest/api/2`;
// ATLASSIAN_*: one account shared with Confluence, set once for atlassian-mcp.
const AUTH = Buffer.from(
  `${process.env.JIRA_USERNAME || process.env.ATLASSIAN_USERNAME}:${process.env.JIRA_PASSWORD || process.env.ATLASSIAN_PASSWORD}`,
).toString("base64");
// A Personal Access Token lets SSO-only accounts (no Jira password) authenticate.
export const AUTH_HEADER = process.env.JIRA_TOKEN
  ? `Bearer ${process.env.JIRA_TOKEN.trim()}`
  : `Basic ${AUTH}`;
const HEADERS = {
  Accept: "application/json",
  Authorization: AUTH_HEADER,
  "Content-Type": "application/json",
};

// Jira Data Center throws transient 5xx/429 under load. Retry only methods
// that are safe to replay: a 500 on POST may already have created a comment,
// a worklog or a transition, so replaying it would duplicate the side effect.
// DELETE is left out too: a 500 may come after the delete went through, and
// the replay's 404 would report a removed item as a failure.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const REPLAYABLE = new Set(["GET", "PUT"]);
const MAX_RETRIES = 2;
// A Jira that stops answering would otherwise hang the tool call forever.
export const TIMEOUT_MS = 30_000;

/**
 * Turns fetch's bare TimeoutError into one the caller can act on: a write
 * that timed out may still have been saved, and a blind retry of a POST
 * logs the same worklog or comment twice. Any other error passes through.
 * @param {string} method
 * @returns {(err: Error) => never}
 */
export const onTimeout = (method) => (err) => {
  if (err.name !== "TimeoutError") throw err;
  throw new Error(
    REPLAYABLE.has(method)
      ? `Jira did not answer within ${TIMEOUT_MS / 1000}s; safe to retry`
      : `Jira did not answer the ${method} within ${TIMEOUT_MS / 1000}s; it may still have been saved, so do not retry: ask the user to check in Jira first`,
  );
};

// Paths are relative to /rest/api/2 unless they name another REST API
// themselves (e.g. /rest/agile/1.0/... for sprints and boards).
export const jiraRequest = async (method, path, body, attempt = 0) => {
  const url = path.startsWith("/rest/")
    ? `${JIRA_HOST}${path}`
    : `${BASE}${path}`;
  const res = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: HEADERS,
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(onTimeout(method));
  if (!res.ok) {
    if (
      attempt < MAX_RETRIES &&
      RETRY_STATUS.has(res.status) &&
      REPLAYABLE.has(method)
    ) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      return jiraRequest(method, path, body, attempt + 1);
    }
    const text = await res.text();
    throw new Error(`Jira API ${res.status}: ${text}`);
  }
  // Not just 204: POST /issueLink answers 201 with an empty body, and parsing
  // that would report a link that was created as a failure.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};

// Attachment content is binary and lives at an absolute URL outside
// /rest/api/2, so it cannot go through jiraRequest. Returns base64.
export const jiraDownload = async (url) => {
  const res = await fetch(url, {headers: {Authorization: AUTH_HEADER}});
  if (!res.ok) throw new Error(`Jira attachment ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
};

// Uploads are multipart, which jiraRequest's JSON headers cannot carry; fetch
// sets the boundary Content-Type itself. Jira Server rejects an attachment
// POST without X-Atlassian-Token (XSRF check). Not retried: it is a POST.
export const jiraUpload = async (ticketId, filename, bytes) => {
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  const res = await fetch(`${BASE}/issue/${ticketId}/attachments`, {
    body: form,
    headers: {
      Accept: "application/json",
      Authorization: AUTH_HEADER,
      "X-Atlassian-Token": "no-check",
    },
    method: "POST",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira API ${res.status}: ${text}`);
  return JSON.parse(text);
};
