import assert from "node:assert/strict";
import {test} from "node:test";
import {registerGenerateReleaseNotes} from "../../src/tools/release/generate.js";
import {fakeServer} from "../helpers/fake-server.js";

const issue = (key, type, status) => ({
  fields: {issuetype: {name: type}, status: {name: status}, summary: key},
  key,
});

test("generate_release_notes matches the Done category and drops work that never shipped", async () => {
  const server = fakeServer();
  let jql;
  registerGenerateReleaseNotes(server, async (_method, path) => {
    jql = new URLSearchParams(path.split("?")[1]).get("jql");
    return {
      issues: [
        issue("PROJ-1", "Story", "DONE"),
        issue("PROJ-2", "Bug", "Closed"),
        issue("PROJ-3", "Task", "Cancelled"),
        issue("PROJ-4", "Bug", "Duplicated"),
        issue("PROJ-5", "Story", "Rejected"),
      ],
    };
  });

  const {content} = await server.tools.get("generate_release_notes")({
    fix_version: "v1",
  });
  assert.match(jql, /statusCategory = Done/);
  assert.doesNotMatch(jql, /status in/);
  assert.match(content[0].text, /## Features\n- PROJ-1/);
  assert.match(content[0].text, /## Bug Fixes\n- PROJ-2/);
  assert.doesNotMatch(content[0].text, /PROJ-[345]/);
});

test("generate_release_notes says when Jira returned only part of the version", async () => {
  const server = fakeServer();
  registerGenerateReleaseNotes(server, async () => ({
    issues: [issue("PROJ-1", "Story", "Done")],
    total: 250,
  }));

  const {content} = await server.tools.get("generate_release_notes")({
    fix_version: "v1",
  });
  assert.match(content[0].text, /only the first 1 of 250 matching issues/);
});
