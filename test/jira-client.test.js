import assert from "node:assert/strict";
import {test} from "node:test";
import {JIRA_HOST, jiraRequest} from "../src/jira-client.js";

// Replaces global fetch with a scripted sequence of statuses and records how
// many times it was actually called.
const stubFetch = (statuses, okBody = '{"ok":true}') => {
  const calls = [];
  globalThis.fetch = async () => {
    const status = statuses[calls.length] ?? 200;
    calls.push(status);
    return {
      ok: status < 400,
      status,
      text: async () => (status < 400 ? okBody : "server exploded"),
    };
  };
  return calls;
};

test("jiraRequest retries a replayable request through two 5xx", async () => {
  const calls = stubFetch([500, 503, 200]);
  assert.deepEqual(await jiraRequest("GET", "/issue/PROJ-1"), {ok: true});
  assert.equal(calls.length, 3);
});

test("jiraRequest gives up after two retries", async () => {
  const calls = stubFetch([500, 500, 500]);
  await assert.rejects(
    () => jiraRequest("GET", "/issue/PROJ-1"),
    /Jira API 500: server exploded/,
  );
  assert.equal(calls.length, 3);
});

test("jiraRequest does not retry a 4xx", async () => {
  const calls = stubFetch([400]);
  await assert.rejects(
    () => jiraRequest("GET", "/issue/PROJ-1"),
    /Jira API 400/,
  );
  assert.equal(calls.length, 1);
});

// A 500 may come after the write went through: a replayed POST duplicates
// it, a replayed DELETE turns a done delete into a 404.
for (const [method, body] of [["POST", {body: "hi"}], ["DELETE"]]) {
  test(`jiraRequest does not replay a ${method}`, async () => {
    const calls = stubFetch([500]);
    await assert.rejects(
      () => jiraRequest(method, "/issue/PROJ-1/comment", body),
      /Jira API 500/,
    );
    assert.equal(calls.length, 1);
  });
}

// A timed-out write may have been saved; only a replayable one may be retried.
for (const [method, says] of [
  ["POST", /may still have been saved, so do not retry/],
  ["DELETE", /may still have been saved, so do not retry/],
  ["GET", /within 30s; safe to retry/],
]) {
  test(`jiraRequest says what a timed-out ${method} means for a retry`, async () => {
    globalThis.fetch = async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    };
    await assert.rejects(
      () => jiraRequest(method, "/issue/PROJ-1/comment"),
      says,
    );
  });
}

test("jiraRequest returns null for a 201 with an empty body", async () => {
  stubFetch([201], "");
  assert.equal(
    await jiraRequest("POST", "/issueLink", {type: {name: "Blocks"}}),
    null,
  );
});

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
