import assert from "node:assert/strict";
import {test} from "node:test";

// MCP client configs often carry a trailing slash or literal quotes; Jira
// answers "//rest/..." with 404 "null for uri". Set before the module reads it.
process.env.JIRA_HOST = ' "https://jira.test/" ';
const {jiraRequest} = await import("../src/jira-client.js");

test("jiraRequest builds a single-slash URL from a host with quotes and trailing slash", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return {ok: true, status: 200, text: async () => "{}"};
  };
  await jiraRequest("GET", "/search?jql=x");
  await jiraRequest("GET", "/rest/agile/1.0/board");
  assert.deepEqual(urls, [
    "https://jira.test/rest/api/2/search?jql=x",
    "https://jira.test/rest/agile/1.0/board",
  ]);
});
