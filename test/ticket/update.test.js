import assert from "node:assert/strict";
import {test} from "node:test";
import {registerUpdateTicket} from "../../src/tools/ticket/update.js";
import {fakeForms, fakeServer} from "../helpers/fake-server.js";

test("update_ticket rejects an empty update", async () => {
  const server = fakeServer();
  registerUpdateTicket(server, async () => {
    throw new Error("jiraRequest should not be called");
  });

  const result = await server.tools.get("update_ticket")({
    ticket_id: "PROJ-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No fields provided to update/);
});

test("update_ticket succeeds when Jira applies the requested parent", async () => {
  const server = fakeServer();
  const calls = [];
  const fakeJira = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === "PUT") return null;
    return {fields: {parent: {key: "PROJ-9"}}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    parent_key: "PROJ-9",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.content[0].text, "PROJ-1 updated successfully");
  assert.deepEqual(calls, [
    "GET /issue/PROJ-1?fields=parent",
    "PUT /issue/PROJ-1",
    "GET /issue/PROJ-1?fields=parent",
  ]);
});

test("update_ticket reports Jira's silent rejection of a Sub-task parent change", async () => {
  const server = fakeServer();
  const fakeJira = async (method) => {
    if (method === "PUT") return null;
    return {fields: {parent: undefined}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    parent_key: "PROJ-9",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /still "no parent"/);
  assert.match(result.content[0].text, /pass issue_type with a sub-task type/);
});

// Scripts Jira's Move > Change Parent form: the parent form carries the
// token, and the submit answers with `submit`.
const moveForm = (submit = {done: true, redirected: true, status: 302}) =>
  fakeForms({
    "MoveSubTaskParent!default": {token: "TOK1"},
    "MoveSubTaskParent.jspa": submit,
  });

// The sub-task reports PROJ-5 as its parent on the first read, then `after`.
// PUT bodies land in `puts`.
const reparentJira = (after, puts = []) => {
  let parent = "PROJ-5";
  return async (method, _path, body) => {
    if (method === "PUT") {
      puts.push(body);
      return null;
    }
    const result = {fields: {parent: {key: parent}}, id: "1001"};
    parent = after;
    return result;
  };
};

test("update_ticket re-parents an existing sub-task through Jira's Change Parent form", async () => {
  const {forms, sent} = moveForm();
  const server = fakeServer();
  registerUpdateTicket(server, reparentJira("PROJ-9"), forms);

  const result = await server.tools.get("update_ticket")({
    parent_key: "PROJ-9",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.content[0].text, "PROJ-1 updated successfully");
  // One session, Move wizard first: the parent form needs both.
  assert.deepEqual(
    sent.map((s) => [s.session, s.method, s.url.replace(/^.*\/secure\//, "")]),
    [
      [1, "open", "MoveSubTaskChooseOperation!default.jspa?id=1001"],
      [1, "open", "MoveSubTaskParent!default.jspa?id=1001"],
      [1, "submit", "MoveSubTaskParent.jspa"],
    ],
  );
  const {fields} = sent[2];
  assert.equal(fields.get("id"), "1001");
  assert.equal(fields.get("parentIssue"), "PROJ-9");
  assert.equal(fields.get("atl_token"), "TOK1");
});

test("update_ticket reports why Jira rejected a sub-task's new parent", async () => {
  const {forms} = moveForm({errors: "Parent issue PROJ-9 is a sub-task"});
  const server = fakeServer();
  const puts = [];
  registerUpdateTicket(server, reparentJira("PROJ-5", puts), forms);

  const result = await server.tools.get("update_ticket")({
    parent_key: "PROJ-9",
    summary: "New title",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Parent issue PROJ-9 is a sub-task/);
  // The rejection reports nothing changed, so the summary must not be saved.
  assert.deepEqual(puts, []);
});

test("update_ticket appends implementation notes to a description sent in the same call", async () => {
  const server = fakeServer();
  const calls = [];
  registerUpdateTicket(server, async (method, path, body) => {
    calls.push([method, path, body]);
    return null;
  });

  await server.tools.get("update_ticket")({
    description: "New text",
    implementation_notes: "Note",
    ticket_id: "PROJ-1",
  });
  assert.deepEqual(calls, [
    [
      "PUT",
      "/issue/PROJ-1",
      {
        fields: {
          description: "New text\n\n--- Implementation Notes ---\nNote",
        },
      },
    ],
  ]);
});

test("update_ticket succeeds when Jira applies the requested Epic Link", async () => {
  const server = fakeServer();
  const calls = [];
  const fakeJira = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === "PUT") return null;
    return {fields: {customfield_10001: "PROJ-9"}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    epic_key: "PROJ-9",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.content[0].text, "PROJ-1 updated successfully");
  assert.deepEqual(calls, [
    "PUT /issue/PROJ-1",
    "GET /issue/PROJ-1?fields=customfield_10001",
  ]);
});

test("update_ticket reports Jira's silent rejection of an Epic Link change", async () => {
  const server = fakeServer();
  const fakeJira = async (method) => {
    if (method === "PUT") return null;
    return {fields: {customfield_10001: undefined}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    epic_key: "PROJ-9",
    ticket_id: "PROJ-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /still "no epic"/);
  assert.match(result.content[0].text, /Sub-tasks or Epics themselves/);
});
