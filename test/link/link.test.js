import assert from "node:assert/strict";
import {test} from "node:test";
import {registerLinkIssues} from "../../src/tools/link/link.js";
import {fakeServer} from "../helpers/fake-server.js";

test("link_tickets links the source to each target and reports the one that failed", async () => {
  const server = fakeServer();
  const posted = [];
  registerLinkIssues(server, async (_method, _path, body) => {
    if (body.outwardIssue.key === "PROJ-3") throw new Error("no such issue");
    posted.push([body.inwardIssue.key, body.outwardIssue.key, body.type.name]);
    return null;
  });

  const result = await server.tools.get("link_tickets")({
    inward_issue: "PROJ-1",
    outward_issues: ["PROJ-2", "PROJ-3", "PROJ-4"],
  });

  assert.deepEqual(posted, [
    ["PROJ-1", "PROJ-2", "Blocks"],
    ["PROJ-1", "PROJ-4", "Blocks"],
  ]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /1 of 3 failed/);
  assert.match(result.content[0].text, /PROJ-3 failed: no such issue/);
});
