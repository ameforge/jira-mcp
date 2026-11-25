import assert from "node:assert/strict";
import {test} from "node:test";
import {JIRA_HOST, jiraRequest} from "../src/jira-client.js";

// Retries, timeouts and empty bodies are tested once in packages/request.
// Here: which methods Jira replays, read through the timeout message that
// uses the same list. A 500 or a timeout may come after a write went through:
// a replayed POST duplicates it, a replayed DELETE turns a done delete into a 404.
for (const [method, says] of [
  [
    "POST",
    /^Jira did not answer the POST within 30s; it may still have been saved, so do not retry/,
  ],
  ["DELETE", /may still have been saved, so do not retry/],
  ["GET", /within 30s; safe to retry/],
  ["PUT", /within 30s; safe to retry/],
]) {
  test(`jiraRequest says what a timed-out ${method} means for a retry`, async () => {
    globalThis.fetch = async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    };
    await assert.rejects(() => jiraRequest(method, "/issue/PROJ-1/comment"), {
      message: says,
    });
  });
}

test("jiraRequest sends /rest/ paths to the host, others under /rest/api/2", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return {ok: true, status: 200, text: async () => "{}"};
  };
  await jiraRequest("GET", "/issue/PROJ-1");
  await jiraRequest("GET", "/rest/agile/1.0/board");
  assert.deepEqual(urls, [
    `${JIRA_HOST}/rest/api/2/issue/PROJ-1`,
    `${JIRA_HOST}/rest/agile/1.0/board`,
  ]);
});
