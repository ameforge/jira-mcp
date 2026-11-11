import assert from "node:assert/strict";
import {test} from "node:test";
import {registerLinkIssues} from "../src/tools/link/link.js";
import {registerCreateTicket} from "../src/tools/ticket/create.js";
import {registerSearchTickets} from "../src/tools/ticket/search.js";
import {registerUpdateTicket} from "../src/tools/ticket/update.js";
import {fakeServer} from "./helpers/fake-server.js";

// Error texts are the ones Jira Data Center returned in real sessions.
const ISSUE_TYPE_JQL = `Jira API 400: {"errorMessages":["The value 'QA-Subtask' does not exist for the field 'issuetype'."],"errors":{}}`;
const ISSUE_TYPE_FIELD = `Jira API 400: {"errorMessages":[],"errors":{"issuetype":"Could not find issuetype by id or name."}}`;
const LINK_TYPE = `Jira API 404: {"errorMessages":["No issue link type with name 'Relates to' found."],"errors":{}}`;

const UPDATE_PLAN = "/issue/PROJ-12?fields=issuetype,status,project";
const LOOKUPS = {
  [UPDATE_PLAN]: {
    fields: {
      issuetype: {id: "1", name: "Task", subtask: false},
      project: {key: "PROJ"},
      status: {name: "Open"},
    },
    id: "12",
  },
  "/issueLinkType": {issueLinkTypes: [{name: "Blocks"}, {name: "Relates"}]},
  "/issuetype": [{name: "Task"}, {name: "QA Sub-Task"}, {name: "Task"}],
  "/project/PROJ": {issueTypes: [{name: "Story"}, {name: "QA Sub-Task"}]},
};

// Fails the tool's own request with jiraError, answers the name lookups.
const call = async (register, name, args, jiraError) => {
  const server = fakeServer();
  const lookups = [];
  register(server, async (_method, path) => {
    if (LOOKUPS[path]) {
      lookups.push(path);
      return LOOKUPS[path];
    }
    throw new Error(jiraError);
  });
  const result = await server.tools.get(name)(args);
  return {lookups, text: result.content[0].text};
};

for (const [register, name, args, jiraError, lookup, valid] of [
  [
    registerSearchTickets,
    "search_tickets",
    {jql: 'issuetype = "QA-Subtask"'},
    ISSUE_TYPE_JQL,
    "/issuetype",
    "Valid issue types: Task, QA Sub-Task",
  ],
  [
    registerCreateTicket,
    "create_ticket",
    {issue_type: "QA-Subtask", project: "PROJ", summary: "x"},
    ISSUE_TYPE_FIELD,
    "/project/PROJ",
    "Valid issue types: Story, QA Sub-Task",
  ],
  [
    registerUpdateTicket,
    "update_ticket",
    {issue_type: "QA-Subtask", ticket_id: "PROJ-12"},
    ISSUE_TYPE_FIELD,
    // Planning the type change reads the ticket and its project first.
    [UPDATE_PLAN, "/project/PROJ", "/project/PROJ"],
    "Valid issue types: Story, QA Sub-Task",
  ],
  [
    registerLinkIssues,
    "link_issues",
    {inward_issue: "PROJ-1", link_type: "Relates to", outward_issue: "PROJ-2"},
    LINK_TYPE,
    "/issueLinkType",
    "Valid link types: Blocks, Relates",
  ],
]) {
  test(`${name} lists the valid names when Jira rejects the type`, async () => {
    const r = await call(register, name, args, jiraError);
    assert.equal(r.text, `${jiraError}\n${valid}`);
    assert.deepEqual(r.lookups, [lookup].flat());
  });
}

test("an unrelated Jira error passes through without a lookup", async () => {
  const err = `Jira API 400: {"errorMessages":["Not able to sort using field 'parent'."],"errors":{}}`;
  const r = await call(
    registerSearchTickets,
    "search_tickets",
    {jql: "x"},
    err,
  );
  assert.equal(r.text, err);
  assert.deepEqual(r.lookups, []);
});

test("update_ticket clears a date given as an empty string", async () => {
  const server = fakeServer();
  const bodies = [];
  registerUpdateTicket(server, async (_m, _p, body) => {
    bodies.push(body);
    return null;
  });
  await server.tools.get("update_ticket")({
    due_date: "",
    start_date: "",
    ticket_id: "PROJ-1",
  });
  assert.deepEqual(bodies, [
    {fields: {customfield_11300: null, duedate: null}},
  ]);
});
