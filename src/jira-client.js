import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {productRequest, TIMEOUT_MS} from "@ameforge/atlassian-request";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: resolve(__dirname, "../.env")});

// MCP configs may pass quotes or a trailing slash; Jira answers "//rest/..." with 404 "null for uri".
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

// A 500 on POST may already have created a comment, a worklog or a transition, so it is not replayed.
const {fetchHeaders, onTimeout, send} = productRequest({
  name: "Jira",
  replayable: ["GET", "PUT"],
});

export {onTimeout, TIMEOUT_MS};

export const jiraRequest = (method, path, body) =>
  send(
    method,
    path.startsWith("/rest/") ? `${JIRA_HOST}${path}` : `${BASE}${path}`,
    {body: body ? JSON.stringify(body) : undefined, headers: HEADERS},
  );

// Not jiraRequest: attachment content is binary and lives at an absolute URL outside /rest/api/2.
export const jiraDownload = async (url) => {
  const res = await fetchHeaders(url, {headers: {Authorization: AUTH_HEADER}});
  if (!res.ok) throw new Error(`Jira attachment ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
};

// Jira Server rejects an attachment POST without X-Atlassian-Token (XSRF check).
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
