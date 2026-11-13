import assert from "node:assert/strict";
import {test} from "node:test";
import {registerTransitionTicket} from "../../src/tools/ticket/transition.js";
import {fakeServer} from "../helpers/fake-server.js";

// A workflow where no transition is literally named after its target status.
const TRANSITIONS = [
  {id: "11", name: "Start Progress", to: {name: "In Progress"}},
  {id: "21", name: "Resolve Issue", to: {name: "Done"}},
  {id: "31", name: "Re-Open", to: {name: "Re-Open"}},
  {id: "41", name: "Put On Hold", to: {name: "Hold"}},
];

const transitionTo = async (status, transitions = TRANSITIONS) => {
  const server = fakeServer();
  const posted = [];
  registerTransitionTicket(server, async (method, _path, body) => {
    if (method === "GET") return {transitions};
    posted.push(body.transition.id);
    return null;
  });
  const result = await server.tools.get("transition_ticket")({
    status,
    ticket_id: "PROJ-1",
  });
  return {posted, result};
};

test('transition_ticket maps "Closed" onto the workflow\'s Done', async () => {
  const {posted, result} = await transitionTo("Closed");
  assert.deepEqual(posted, ["21"]);
  assert.equal(result.content[0].text, 'PROJ-1 transitioned to "Done"');
});

test("transition_ticket matches the target status, not just the transition name", async () => {
  const {posted} = await transitionTo("In Progress");
  assert.deepEqual(posted, ["11"]);
});

test("transition_ticket resolves Reopen to Re-Open", async () => {
  const {posted} = await transitionTo("reopen");
  assert.deepEqual(posted, ["31"]);
});

test("transition_ticket prefers an alias hit over a substring hit", async () => {
  // A loose substring pass would send "Closed" to "Reject as Closed-Invalid".
  const {posted} = await transitionTo("Closed", [
    {id: "51", name: "Reject as Closed-Invalid", to: {name: "Invalid"}},
    {id: "21", name: "Resolve Issue", to: {name: "Done"}},
  ]);
  assert.deepEqual(posted, ["21"]);
});

test("transition_ticket posts nothing for an empty status", async () => {
  const {posted, result} = await transitionTo("  ");
  assert.deepEqual(posted, []);
  assert.equal(result.isError, true);
});

test('transition_ticket never maps "Cancelled" onto Done', async () => {
  const {posted, result} = await transitionTo("Cancelled");
  assert.deepEqual(posted, []);
  assert.match(result.content[0].text, /Status "Cancelled" not found/);
});

test("transition_ticket lists transition and target names when nothing matches", async () => {
  const {posted, result} = await transitionTo("Deployed");
  assert.deepEqual(posted, []);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Start Progress -> In Progress/);
  assert.match(result.content[0].text, /Re-Open,/);
});

test("transition_tickets continues past a failing ticket and reports it as an error", async () => {
  const server = fakeServer();
  const posted = [];
  registerTransitionTicket(server, async (method, path) => {
    if (method === "GET") {
      if (path.includes("PROJ-2")) throw new Error("not found");
      return {transitions: TRANSITIONS};
    }
    posted.push(path);
    return null;
  });
  const result = await server.tools.get("transition_tickets")({
    status: "Done",
    ticket_ids: ["proj-1", "PROJ-2", "PROJ-3"],
  });
  assert.deepEqual(posted, [
    "/issue/PROJ-1/transitions",
    "/issue/PROJ-3/transitions",
  ]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /1 of 3 failed/);
  assert.match(result.content[0].text, /PROJ-2 failed: not found/);
});
