import assert from "node:assert/strict";
import {mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {JIRA_HOST, jiraUpload} from "../../src/jira-client.js";
import {registerAddAttachment} from "../../src/tools/attachment/add.js";
import {fakeServer} from "../helpers/fake-server.js";

test("jiraUpload posts multipart with the XSRF bypass header", async () => {
  let req;
  globalThis.fetch = async (url, init) => {
    req = {init, url};
    return {ok: true, status: 200, text: async () => '[{"id":"1"}]'};
  };
  assert.deepEqual(await jiraUpload("PROJ-1", "a.txt", Buffer.from("hi")), [
    {id: "1"},
  ]);
  assert.equal(req.url, `${JIRA_HOST}/rest/api/2/issue/PROJ-1/attachments`);
  assert.equal(req.init.method, "POST");
  assert.equal(req.init.headers["X-Atlassian-Token"], "no-check");
  // A JSON Content-Type would replace fetch's multipart boundary header.
  assert.equal(req.init.headers["Content-Type"], undefined);
  const file = req.init.body.get("file");
  assert.equal(file.name, "a.txt");
  assert.equal(await file.text(), "hi");
});

test("add_attachment uploads the file under its base name and rejects non-files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-mcp-"));
  const path = join(dir, "log.txt");
  await writeFile(path, "boom");
  const uploads = [];
  const server = fakeServer();
  registerAddAttachment(server, async (...args) => {
    uploads.push(args);
    return [{filename: "log.txt", id: "10200", size: 4}];
  });
  const call = server.tools.get("add_attachment");

  const ok = await call({file_path: path, ticket_id: "PROJ-1"});
  assert.equal(
    ok.content[0].text,
    "Attached log.txt (#10200, 4 bytes) to PROJ-1",
  );
  assert.deepEqual(uploads, [["PROJ-1", "log.txt", Buffer.from("boom")]]);

  const bad = await call({file_path: dir, ticket_id: "PROJ-1"});
  assert.equal(bad.isError, true);
  assert.equal(bad.content[0].text, `Not a file: ${dir}`);
  assert.equal(uploads.length, 1);
});
