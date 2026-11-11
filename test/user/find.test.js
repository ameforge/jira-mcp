import assert from "node:assert/strict";
import {test} from "node:test";
import {registerFindUser} from "../../src/tools/user/find.js";
import {fakeServer} from "../helpers/fake-server.js";

test("find_user searches by username and leads each line with the username assignee takes", async () => {
  const server = fakeServer();
  const requests = [];
  registerFindUser(server, async (...req) => {
    requests.push(req);
    return [
      {displayName: "Chu Phuong Nam", emailAddress: "n@x.test", name: "namcp"},
      {active: false, displayName: "Old Nam", name: "oldnam"},
    ];
  });
  const result = await server.tools.get("find_user")({query: " nam "});
  assert.deepEqual(requests, [
    ["GET", "/user/search?maxResults=10&username=nam"],
  ]);
  assert.equal(
    result.content[0].text,
    "namcp | Chu Phuong Nam | n@x.test\noldnam | Old Nam (inactive)",
  );
});
