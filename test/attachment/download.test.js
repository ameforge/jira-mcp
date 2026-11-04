import assert from "node:assert/strict";
import {mkdtemp, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {test} from "node:test";
import {registerDownloadAttachment} from "../../src/tools/attachment/download.js";
import {fakeServer} from "../helpers/fake-server.js";

test("download_attachment saves under the Jira base name and never overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jira-mcp-"));
  const requests = [];
  const server = fakeServer();
  registerDownloadAttachment(
    server,
    async (...req) => {
      requests.push(req);
      return {content: "https://jira/secure/a/10200", filename: "../log.txt"};
    },
    async (url) => {
      assert.equal(url, "https://jira/secure/a/10200");
      return Buffer.from("boom").toString("base64");
    },
  );
  const call = server.tools.get("download_attachment");
  const path = join(dir, "log.txt");

  const ok = await call({attachment_id: "10200", dir});
  assert.equal(
    ok.content[0].text,
    `Saved ../log.txt (#10200, 4 bytes) to ${path}`,
  );
  assert.deepEqual(requests, [["GET", "/attachment/10200"]]);
  assert.equal(await readFile(path, "utf8"), "boom");

  const again = await call({attachment_id: "10200", dir});
  assert.equal(again.isError, true);
  assert.equal(again.content[0].text, `File already exists: ${path}`);
});
