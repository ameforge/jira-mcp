import assert from "node:assert/strict";
import {test} from "node:test";
import {registerLinkIssues} from "../../src/tools/link/link.js";
import {fakeServer} from "../helpers/fake-server.js";

const BLOCKS = {inward: "is blocked by", name: "Blocks", outward: "blocks"};
const RELATES = {inward: "relates to", name: "Relates", outward: "relates to"};

const run = async (name, args, failKey) => {
  const server = fakeServer();
  const gets = [];
  const posted = [];
  registerLinkIssues(server, async (method, path, body) => {
    if (method === "GET") {
      gets.push(path);
      return {issueLinkTypes: [BLOCKS, RELATES]};
    }
    if (body.outwardIssue.key === failKey) throw new Error("no such issue");
    posted.push([body.inwardIssue.key, body.outwardIssue.key, body.type.name]);
    return null;
  });
  const result = await server.tools.get(name)(args);
  return {gets, isError: result.isError, posted, text: result.content[0].text};
};

test("link_issues resolves the link type by name or verb, swapping for the inward verb", async () => {
  for (const [link_type, post, text] of [
    [
      "Relates to",
      ["PROJ-1", "PROJ-2", "Relates"],
      "Linked: PROJ-1 relates to PROJ-2 (Relates)",
    ],
    [
      "is blocked by",
      ["PROJ-2", "PROJ-1", "Blocks"],
      "Linked: PROJ-2 blocks PROJ-1 (Blocks)",
    ],
    [
      " BLOCKS ",
      ["PROJ-1", "PROJ-2", "Blocks"],
      "Linked: PROJ-1 blocks PROJ-2 (Blocks)",
    ],
  ]) {
    const r = await run("link_issues", {
      inward_issue: "PROJ-1",
      link_type,
      outward_issue: "PROJ-2",
    });
    assert.deepEqual(r.posted, [post], link_type);
    assert.equal(r.text, text);
  }
});

test("link_issues lists the valid link types for an unknown one and links nothing", async () => {
  const r = await run("link_issues", {
    inward_issue: "PROJ-1",
    link_type: "Clones",
    outward_issue: "PROJ-2",
  });
  assert.equal(r.isError, true);
  assert.deepEqual(r.posted, []);
  assert.match(r.text, /"Clones".*Valid link types: Blocks, Relates$/);
});

test("link_tickets links the source to each target and reports the one that failed", async () => {
  const r = await run(
    "link_tickets",
    {inward_issue: "PROJ-1", outward_issues: ["PROJ-2", "PROJ-3", "PROJ-4"]},
    "PROJ-3",
  );

  assert.deepEqual(r.gets, ["/issueLinkType"]);
  assert.deepEqual(r.posted, [
    ["PROJ-1", "PROJ-2", "Blocks"],
    ["PROJ-1", "PROJ-4", "Blocks"],
  ]);
  assert.equal(r.isError, true);
  assert.match(r.text, /1 of 3 failed/);
  assert.match(r.text, /PROJ-3 failed: no such issue/);
});
