import assert from "node:assert/strict";
import {test} from "node:test";
import {fakeServer} from "../helpers/fake-server.js";

// The wizard URL starts from JIRA_HOST, read when jira-client.js loads, so set
// it before the import; otherwise the tests depend on a local .env.
process.env.JIRA_HOST = "https://jira.test";
const {registerUpdateTicket} = await import("../../src/tools/ticket/update.js");

const page = (action, fields, submit, text = "") =>
  `<form action="${action}" method="post" name="jiraform">${text}${fields}` +
  `<input type="submit" name="${submit}" value="${submit}"></form>`;

// Jira's Convert Sub-task to Issue wizard, trimmed to what the real pages
// carry: a type select on step 1, then the confirm page whose Finish ends on
// the issue page. `confirmText` is the confirm page's summary table;
// `afterType` replaces the page Jira answers the type step with.
const stubConvertWizard = (confirmText = "Type Sub-task Task", afterType) => {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({body: init.body, cookie: init.headers.Cookie, url});
    const at = (path) => url.includes(path);
    const html = at("ConvertSubTask.jspa")
      ? page(
          "ConvertSubTaskSetIssueType.jspa",
          '<select name="issuetype"><option value="10100">Task</option></select>' +
            '<input type="hidden" name="id" value="1001"><input type="hidden" name="guid" value="7">' +
            '<input type="hidden" name="note" value="&quot;a&quot; &#39;b&#39; &lt;c&gt; &amp;lt;">',
          "Next &gt;&gt;",
        )
      : afterType && at("SetIssueType")
        ? afterType
        : page(
            "ConvertSubTaskConvert.jspa",
            '<input type="hidden" name="id" value="1001"><input type="hidden" name="guid" value="7">',
            "Finish",
            confirmText,
          );
    const finish = at("ConvertSubTaskConvert.jspa");
    return {
      headers: {
        get: () => (finish ? "/browse/GEM-1" : null),
        getSetCookie: () =>
          sent.length === 1 ? ["JSESSIONID=s1; Path=/"] : [],
      },
      status: finish ? 302 : 200,
      text: async () => html,
    };
  };
  return sent;
};

// The ticket is a Sub-task until the wizard's Finish has been posted. PUT
// bodies land in `puts`.
const subtaskJira = (sent, puts) => async (method, path, body) => {
  if (method === "PUT") {
    puts.push(body);
    return null;
  }
  if (path === "/project/GEM") {
    return {issueTypes: [{id: "10100", name: "Task", subtask: false}]};
  }
  const finished = sent.some((s) => s.url.includes("ConvertSubTaskConvert"));
  return {
    fields: {
      issuetype: finished
        ? {name: "Task", subtask: false}
        : {name: "Sub-task", subtask: true},
      project: {key: "GEM"},
      status: {name: "Open"},
    },
    id: "1001",
  };
};

const convertToTask = (sent, puts = [], args = {}) => {
  const server = fakeServer();
  registerUpdateTicket(server, subtaskJira(sent, puts));
  return server.tools.get("update_ticket")({
    issue_type: "Task",
    ticket_id: "GEM-1",
    ...args,
  });
};

test("update_ticket converts a sub-task to a standard type through Jira's wizard", async () => {
  const sent = stubConvertWizard();
  const puts = [];
  const result = await convertToTask(sent, puts, {summary: "New title"});

  assert.equal(result.content[0].text, "GEM-1 updated successfully");
  // REST rejects or ignores a sub-task conversion, so only the other fields
  // go over REST.
  assert.deepEqual(puts, [{fields: {summary: "New title"}}]);
  assert.deepEqual(
    sent.map((s) => s.url.replace(/^.*\/secure\//, "")),
    [
      "ConvertSubTask.jspa?id=1001",
      "ConvertSubTaskSetIssueType.jspa",
      "ConvertSubTaskConvert.jspa",
    ],
  );
  const chosen = new URLSearchParams(sent[1].body);
  assert.equal(chosen.get("issuetype"), "10100");
  assert.equal(chosen.get("guid"), "7");
  // Pre-filled values go back as the text the page showed, not as entities.
  assert.equal(chosen.get("note"), `"a" 'b' <c> &lt;`);
  assert.equal(sent[2].cookie, "JSESSIONID=s1");
});

test("update_ticket says the type changed when the later field save fails", async () => {
  const sent = stubConvertWizard();
  const server = fakeServer();
  const jira = subtaskJira(sent, []);
  registerUpdateTicket(server, async (method, path, body) => {
    if (method === "PUT") throw new Error("Jira API 400: priority");
    return jira(method, path, body);
  });
  const result = await server.tools.get("update_ticket")({
    issue_type: "Task",
    priority: "Hgh",
    ticket_id: "GEM-1",
  });

  assert.equal(result.isError, true);
  assert.match(
    result.content[0].text,
    /^GEM-1: changed issue type to "Task", but the other fields were not saved: Jira API 400: priority$/,
  );
});

test("update_ticket never finishes a type change that would delete field values", async () => {
  const sent = stubConvertWizard(
    "Type Sub-task Task Removed fields Severity Normal Removed",
  );
  const puts = [];
  const result = await convertToTask(sent, puts, {summary: "New title"});

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /would delete field values/);
  // The error says nothing was changed, so the other fields must not be saved.
  assert.deepEqual(puts, []);
  assert.match(result.content[0].text, /Severity Normal/);
  assert.ok(!sent.some((s) => s.url.includes("ConvertSubTaskConvert")));
});

test("update_ticket stops when the new workflow lacks the ticket's status", async () => {
  // Field name and options as Jira renders the step for a status the new
  // workflow does not have; no option is pre-selected.
  const sent = stubConvertWizard(
    undefined,
    page(
      "ConvertSubTaskSetStatus.jspa",
      '<select name="targetStatusId"><option value="10900">New</option>' +
        '<option value="6">Closed</option></select><input type="hidden" name="id" value="1001">',
      "Next &gt;&gt;",
    ),
  );
  const result = await convertToTask(sent);

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no "Open" status/);
  assert.match(result.content[0].text, /New, Closed/);
  assert.ok(!sent.some((s) => /SetStatus|Convert\.jspa/.test(s.url)));
});
