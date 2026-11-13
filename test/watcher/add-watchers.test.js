import assert from "node:assert/strict";
import {test} from "node:test";
import {registerAddWatcher} from "../../src/tools/watcher/add.js";
import {fakeServer} from "../helpers/fake-server.js";

test("add_watchers adds the user to every ticket and reports the one that failed", async () => {
  const server = fakeServer();
  const posted = [];
  registerAddWatcher(server, async (_method, path, body) => {
    if (path.includes("PROJ-2")) throw new Error("no permission");
    posted.push([path, body]);
    return null;
  });

  const result = await server.tools.get("add_watchers")({
    ticket_ids: ["PROJ-1", "PROJ-2", "PROJ-3"],
    username: "jdoe",
  });

  assert.deepEqual(posted, [
    ["/issue/PROJ-1/watchers", "jdoe"],
    ["/issue/PROJ-3/watchers", "jdoe"],
  ]);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /PROJ-2 failed: no permission/);
});
