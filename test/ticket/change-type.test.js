import assert from "node:assert/strict";
import {test} from "node:test";
import {registerUpdateTicket} from "../../src/tools/ticket/update.js";
import {fakeForms, fakeServer} from "../helpers/fake-server.js";

const page = (action, fields, submit, text = "") =>
  `<form action="${action}" method="post" name="jiraform">${text}${fields}` +
  `<input type="submit" name="${submit}" value="${submit}"></form>`;

// Jira's Convert Sub-task to Issue wizard, trimmed to what the real pages
// carry: a type select on step 1, then the confirm page whose Finish ends on
// the issue page. `confirmText` is the confirm page's summary table;
// `afterType` replaces the page Jira answers the type step with.
const convertWizard = (confirmText = "Type Sub-task Task", afterType) =>
  fakeForms({
    "ConvertSubTask.jspa": {
      html: page(
        "ConvertSubTaskSetIssueType.jspa",
        '<select name="issuetype"><option value="10100">Task</option></select>' +
          '<input type="hidden" name="id" value="1001"><input type="hidden" name="guid" value="7">' +
          '<input type="hidden" name="note" value="&quot;a&quot; &#39;b&#39; &lt;c&gt; &amp;lt;">',
        "Next &gt;&gt;",
      ),
    },
    "ConvertSubTaskConvert.jspa": {done: true, redirected: true, status: 302},
    "ConvertSubTaskSetIssueType.jspa": {
      html:
        afterType ??
        page(
          "ConvertSubTaskConvert.jspa",
          '<input type="hidden" name="id" value="1001"><input type="hidden" name="guid" value="7">',
          "Finish",
          confirmText,
        ),
    },
  });

// The ticket is a Sub-task until the wizard's Finish has been posted. PUT
// bodies land in `puts`.
const subtaskJira = (sent, puts) => async (method, path, body) => {
  if (method === "PUT") {
    puts.push(body);
    return null;
  }
  if (path === "/project/PROJ") {
    return {issueTypes: [{id: "10100", name: "Task", subtask: false}]};
  }
  const finished = sent.some((s) => s.url.includes("ConvertSubTaskConvert"));
  return {
    fields: {
      issuetype: finished
        ? {name: "Task", subtask: false}
        : {name: "Sub-task", subtask: true},
      project: {key: "PROJ"},
      status: {name: "Open"},
    },
    id: "1001",
  };
};

const convertToTask = ({forms, sent}, puts = [], args = {}) => {
  const server = fakeServer();
  registerUpdateTicket(server, subtaskJira(sent, puts), forms);
  return server.tools.get("update_ticket")({
    issue_type: "Task",
    ticket_id: "PROJ-1",
    ...args,
  });
};

test("update_ticket converts a sub-task to a standard type through Jira's wizard", async () => {
  const wizard = convertWizard();
  const puts = [];
  const result = await convertToTask(wizard, puts, {summary: "New title"});

  assert.equal(result.content[0].text, "PROJ-1 updated successfully");
  // REST rejects or ignores a sub-task conversion, so only the other fields
  // go over REST.
  assert.deepEqual(puts, [{fields: {summary: "New title"}}]);
  // One session: the wizard's atl_token is tied to it.
  assert.deepEqual(
    wizard.sent.map((s) => [
      s.session,
      s.method,
      s.url.replace(/^.*\/secure\//, ""),
    ]),
    [
      [1, "open", "ConvertSubTask.jspa?id=1001"],
      [1, "submit", "ConvertSubTaskSetIssueType.jspa"],
      [1, "submit", "ConvertSubTaskConvert.jspa"],
    ],
  );
  const chosen = wizard.sent[1].fields;
  assert.equal(chosen.get("issuetype"), "10100");
  assert.equal(chosen.get("guid"), "7");
  // Pre-filled values go back as the text the page showed, not as entities.
  assert.equal(chosen.get("note"), `"a" 'b' <c> &lt;`);
});

test("update_ticket says the type changed when the later field save fails", async () => {
  const {forms, sent} = convertWizard();
  const server = fakeServer();
  const jira = subtaskJira(sent, []);
  registerUpdateTicket(
    server,
    async (method, path, body) => {
      if (method === "PUT") throw new Error("Jira API 400: priority");
      return jira(method, path, body);
    },
    forms,
  );
  const result = await server.tools.get("update_ticket")({
    issue_type: "Task",
    priority: "Hgh",
    ticket_id: "PROJ-1",
  });

  assert.equal(result.isError, true);
  assert.match(
    result.content[0].text,
    /^PROJ-1: changed issue type to "Task", but the other fields were not saved: Jira API 400: priority$/,
  );
});

test("update_ticket never finishes a type change that would delete field values", async () => {
  const wizard = convertWizard(
    "Type Sub-task Task Removed fields Severity Normal Removed",
  );
  const puts = [];
  const result = await convertToTask(wizard, puts, {summary: "New title"});

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /would delete field values/);
  // The error says nothing was changed, so the other fields must not be saved.
  assert.deepEqual(puts, []);
  assert.match(result.content[0].text, /Severity Normal/);
  assert.ok(!wizard.sent.some((s) => s.url.includes("ConvertSubTaskConvert")));
});

test("update_ticket stops when the new workflow lacks the ticket's status", async () => {
  // Field name and options as Jira renders the step for a status the new
  // workflow does not have; no option is pre-selected.
  const wizard = convertWizard(
    undefined,
    page(
      "ConvertSubTaskSetStatus.jspa",
      '<select name="targetStatusId"><option value="10900">New</option>' +
        '<option value="6">Closed</option></select><input type="hidden" name="id" value="1001">',
      "Next &gt;&gt;",
    ),
  );
  const result = await convertToTask(wizard);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no "Open" status/);
  assert.match(result.content[0].text, /New, Closed/);
  assert.ok(!wizard.sent.some((s) => /SetStatus|Convert\.jspa/.test(s.url)));
});
