import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {productRequest, TIMEOUT_MS} from "@ameforge/atlassian-request";
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

// A 500 on POST may already have created a comment, a worklog or a
// transition, so only GET and PUT are replayed.
const {onTimeout, send} = productRequest({
  name: "Jira",
  replayable: ["GET", "PUT"],
});

export {onTimeout, TIMEOUT_MS};

// Paths are relative to /rest/api/2 unless they name another REST API
// themselves (e.g. /rest/agile/1.0/... for sprints and boards).
export const jiraRequest = (method, path, body) =>
  send(
    method,
    path.startsWith("/rest/") ? `${JIRA_HOST}${path}` : `${BASE}${path}`,
    {body: body ? JSON.stringify(body) : undefined, headers: HEADERS},
  );

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
