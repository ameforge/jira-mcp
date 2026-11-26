import assert from "node:assert/strict";
import {test} from "node:test";

// Empty, not unset: dotenv would fill an unset one from a local .env. Set before the module reads them.
process.env.JIRA_TOKEN = "";
process.env.JIRA_USERNAME = "";
process.env.JIRA_PASSWORD = "jira-pass";
process.env.ATLASSIAN_USERNAME = "shared-user";
process.env.ATLASSIAN_PASSWORD = "shared-pass";
const {AUTH_HEADER} = await import("../src/jira-client.js");

test("an unset JIRA_* credential falls back to ATLASSIAN_*, a set one wins", () => {
  assert.equal(
    AUTH_HEADER,
    `Basic ${Buffer.from("shared-user:jira-pass").toString("base64")}`,
  );
});
