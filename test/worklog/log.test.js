import assert from "node:assert/strict";
import {test} from "node:test";
import {registerLogWork} from "../../src/tools/worklog/log.js";
import {fakeForms, fakeServer} from "../helpers/fake-server.js";

const FORM_HTML =
  '<form action="x?atl_token=TOK123"><input name="startDateJS" value="27/Sep/26 9:00 AM">' +
  '<input name="startDate" value="2026-09-27 09:00"></form>';

// Scripts the WorklogPRO dialog (`form`) and its submit (`submit`) on top of
// a dialog that loads with its token.
const worklogForms = ({form = {}, submit = {}} = {}) =>
  fakeForms({
    "!default.jspa": {html: FORM_HTML, token: "TOK123", ...form},
    "WorkLogAction.jspa": submit,
  });

const logWork = (args, {forms}, jira) => {
  const server = fakeServer();
  registerLogWork(server, jira, forms);
  return server.tools.get("log_work")({
    ticket_id: "PROJ-1",
    time_spent: "2h",
    ...args,
  });
};

const ATTRS = {activity: "review", work_type: "dev"};

test("log_work sets attributes through the WorklogPRO form", async () => {
  const wp = worklogForms();
  const {content, isError} = await logWork(ATTRS, wp);
  assert.equal(isError, undefined);
  assert.deepEqual(
    wp.sent.map((s) => [s.session, s.method]),
    [
      [1, "open"],
      [1, "submit"],
    ],
  );
  const submit = wp.sent[1];
  assert.match(submit.url, /WorkLogAction\.jspa\?atl_token=TOK123$/);
  // dev -> Type of Work 3, review -> Type of Activity 9 (WorklogPRO ids).
  assert.equal(submit.fields.get("wa_1"), "3");
  assert.equal(submit.fields.get("wa_2"), "9");
  assert.equal(content[0].text, "Logged 2h on PROJ-1 [dev/review]");
});

test("log_work fails without logging when the form is unavailable", async () => {
  const wp = worklogForms({form: {ok: false, status: 403}});
  const {content, isError} = await logWork(ATTRS, wp);
  assert.equal(isError, true);
  assert.deepEqual(
    wp.sent.map((s) => s.method),
    ["open"],
  );
  assert.match(content[0].text, /HTTP 403.*nothing was logged/);
});

test("log_work does not replay a failed form submit over REST", async () => {
  const wp = worklogForms({submit: {ok: false, status: 500}});
  const {content, isError} = await logWork(ATTRS, wp, async () => {
    throw new Error("REST must not be called");
  });
  assert.equal(isError, true);
  assert.match(content[0].text, /do not retry.*Work Log tab of PROJ-1/);
});

// WorklogPRO answers a rejected submit with HTTP 200 and the reasons in the
// page; the caller needs every reason and to know nothing was logged.
test("log_work reports the form's errors", async () => {
  const wp = worklogForms({
    submit: {errors: "You must indicate the time spent working."},
  });
  const {content, isError} = await logWork(ATTRS, wp);
  assert.equal(isError, true);
  assert.equal(
    content[0].text,
    "WorklogPRO: You must indicate the time spent working.; nothing was logged, fix the input and retry",
  );
});

test("log_work reports a rejected token instead of success", async () => {
  const wp = worklogForms({
    submit: {html: "<h1>XSRF Security Token Missing</h1>"},
  });
  const {content, isError} = await logWork(ATTRS, wp);
  assert.equal(isError, true);
  assert.match(content[0].text, /XSRF token rejected/);
});

test("log_work rejects an unknown alias before any request", async () => {
  const wp = worklogForms();
  const {content, isError} = await logWork(
    {activity: "review", work_type: "napping"},
    wp,
  );
  assert.equal(isError, true);
  assert.deepEqual(wp.sent, []);
  assert.match(content[0].text, /Unknown work_type "napping"/);
});

test("log_work without attributes logs over plain REST", async () => {
  const wp = worklogForms();
  const requests = [];
  const {content} = await logWork({}, wp, async (...req) => {
    requests.push(req);
    return {id: "777"};
  });
  assert.deepEqual(requests, [
    ["POST", "/issue/PROJ-1/worklog", {timeSpent: "2h"}],
  ]);
  // The form flow stays untouched on the REST path.
  assert.deepEqual(wp.sent, []);
  assert.equal(content[0].text, "Logged 2h on PROJ-1 (worklog id: 777)");
});
