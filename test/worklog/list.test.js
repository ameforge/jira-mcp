import assert from "node:assert/strict";
import {test} from "node:test";
import {registerListWorklogs} from "../../src/tools/worklog/list.js";
import {fakeServer} from "../helpers/fake-server.js";

const run = async (args, worklogs) => {
  const server = fakeServer();
  const requests = [];
  registerListWorklogs(server, async (method, path) => {
    requests.push([method, path]);
    if (path === "/myself") return {key: "me"};
    if (path.startsWith("/search?")) return {issues: [{key: "PROJ-1"}]};
    if (path === "/issue/PROJ-1/worklog") return {worklogs};
    throw new Error(`unexpected ${path}`);
  });
  const result = await server.tools.get("list_worklogs")(args);
  return {requests, text: result.content[0].text};
};

const log = (id, key, started, seconds) => ({
  author: {key},
  id,
  started,
  timeSpent: `${seconds / 3600}h`,
  timeSpentSeconds: seconds,
});

test("list_worklogs keeps only my worklogs on the day in the Jira timezone and totals them", async () => {
  const {requests, text} = await run({date: "2026-11-16"}, [
    // 23:30 UTC on the 15th is 06:30 on the 16th in Asia/Ho_Chi_Minh.
    log("1", "me", "2026-11-15T23:30:00.000+0000", 3600),
    log("2", "me", "2026-11-16T14:00:00.000+0700", 5400),
    log("3", "someone", "2026-11-16T09:00:00.000+0700", 7200),
    log("4", "me", "2026-11-17T09:00:00.000+0700", 3600),
  ]);
  assert.equal(
    text,
    [
      "Worklogs on 2026-11-16: 2, total 2.5h",
      "  PROJ-1 #1 06:30 1h",
      "  PROJ-1 #2 14:00 1.5h",
    ].join("\n"),
  );
  const jql = new URLSearchParams(requests[1][1].split("?")[1]).get("jql");
  assert.match(jql, /worklogAuthor = currentUser\(\)/);
});

test("list_worklogs with user searches and keeps that user's worklogs by username", async () => {
  const other = (id, name) => ({
    ...log(id, "JIRAUSER1", "2026-11-16T09:00:00.000+0700", 3600),
    author: {key: "JIRAUSER1", name},
  });
  const {requests, text} = await run({date: "2026-11-16", user: "vuongnm"}, [
    other("5", "VuongNM"),
    other("6", "someone"),
  ]);
  assert.equal(
    text,
    "Worklogs of vuongnm on 2026-11-16: 1, total 1h\n  PROJ-1 #5 09:00 1h",
  );
  assert.equal(requests[0][1].startsWith("/search?"), true);
  const jql = new URLSearchParams(requests[0][1].split("?")[1]).get("jql");
  assert.match(jql, /^worklogAuthor = "vuongnm" AND /);
});

test("list_worklogs rejects a username that could break out of JQL", async () => {
  const {requests, text} = await run({user: 'x" OR worklogAuthor != "x'}, []);
  assert.deepEqual(requests, []);
  assert.match(text, /Invalid username/);
});

test("list_worklogs rejects a malformed date before querying Jira", async () => {
  const {requests, text} = await run({date: '2026-11-16" OR 1=1'}, []);
  assert.deepEqual(requests, []);
  assert.match(text, /Invalid date/);
});
