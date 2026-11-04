import assert from "node:assert/strict";
import {test} from "node:test";
import {registerUpdateTicket} from "../../src/tools/ticket/update.js";
import {fakeServer} from "../helpers/fake-server.js";

test("update_ticket rejects an empty update", async () => {
  const server = fakeServer();
  registerUpdateTicket(server, async () => {
    throw new Error("jiraRequest should not be called");
  });

  const result = await server.tools.get("update_ticket")({
    ticket_id: "GEM-1",
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
    return {fields: {parent: {key: "GEM-9"}}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    parent_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.content[0].text, "GEM-1 updated successfully");
  assert.deepEqual(calls, [
    "PUT /issue/GEM-1",
    "GET /issue/GEM-1?fields=parent",
    "GET /issue/GEM-1?fields=parent",
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
    parent_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /still "no parent"/);
  assert.match(result.content[0].text, /pass issue_type with a sub-task type/);
});

// Scripts Jira's Move > Change Parent form: the wizard start sets the session
// cookie, the parent form carries the token, and the submit answers `submit`.
const stubMoveForm = ({submit = 302, submitHtml = ""} = {}) => {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({body: init.body, cookie: init.headers?.Cookie, url});
    const html = url.includes("MoveSubTaskParent!default")
      ? '<input type="hidden" id="atl_token" name="atl_token"\n  value="TOK1" />'
      : submitHtml;
    return {
      headers: {getSetCookie: () => ["JSESSIONID=s1; Path=/"]},
      status: url.endsWith("MoveSubTaskParent.jspa") ? submit : 200,
      text: async () => html,
    };
  };
  return sent;
};

// The sub-task reports GEM-5 as its parent on the first read, then `after`.
const reparentJira = (after) => {
  let parent = "GEM-5";
  return async (method) => {
    if (method === "PUT") return null;
    const result = {fields: {parent: {key: parent}}, id: "1001"};
    parent = after;
    return result;
  };
};

test("update_ticket re-parents an existing sub-task through Jira's Change Parent form", async () => {
  const sent = stubMoveForm();
  const server = fakeServer();
  registerUpdateTicket(server, reparentJira("GEM-9"));

  const result = await server.tools.get("update_ticket")({
    parent_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.content[0].text, "GEM-1 updated successfully");
  const submit = sent.at(-1);
  assert.match(submit.url, /MoveSubTaskParent\.jspa$/);
  assert.equal(submit.cookie, "JSESSIONID=s1");
  assert.equal(sent[1].cookie, "JSESSIONID=s1");
  const fields = new URLSearchParams(submit.body);
  assert.equal(fields.get("id"), "1001");
  assert.equal(fields.get("parentIssue"), "GEM-9");
  assert.equal(fields.get("atl_token"), "TOK1");
});

test("update_ticket reports why Jira rejected a sub-task's new parent", async () => {
  stubMoveForm({
    submit: 200,
    submitHtml: '<div class="error">Parent issue GEM-9 is a sub-task</div>',
  });
  const server = fakeServer();
  registerUpdateTicket(server, reparentJira("GEM-5"));

  const result = await server.tools.get("update_ticket")({
    parent_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Parent issue GEM-9 is a sub-task/);
});

test("update_ticket succeeds when Jira applies the requested Epic Link", async () => {
  const server = fakeServer();
  const calls = [];
  const fakeJira = async (method, path) => {
    calls.push(`${method} ${path}`);
    if (method === "PUT") return null;
    return {fields: {customfield_10001: "GEM-9"}};
  };
  registerUpdateTicket(server, fakeJira);

  const result = await server.tools.get("update_ticket")({
    epic_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.content[0].text, "GEM-1 updated successfully");
  assert.deepEqual(calls, [
    "PUT /issue/GEM-1",
    "GET /issue/GEM-1?fields=customfield_10001",
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
    epic_key: "GEM-9",
    ticket_id: "GEM-1",
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /still "no epic"/);
  assert.match(result.content[0].text, /Sub-tasks or Epics themselves/);
});
