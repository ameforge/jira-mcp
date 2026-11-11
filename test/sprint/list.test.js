import assert from "node:assert/strict";
import {test} from "node:test";
import {registerListSprints} from "../../src/tools/sprint/list.js";
import {fakeServer} from "../helpers/fake-server.js";

const AGILE = "/rest/agile/1.0";

test("list_sprints gives each open sprint's ID, the value move_to_sprint takes", async () => {
  const server = fakeServer();
  const routes = {
    [`${AGILE}/board?projectKeyOrId=PROJ`]: {values: [{id: 2, type: "scrum"}]},
    [`${AGILE}/board/2/sprint?state=active,future`]: {
      values: [
        {
          endDate: "2026-11-13T12:00:00.000Z",
          id: 41,
          name: "PROJ Sprint 12",
          startDate: "2026-11-02T05:00:00.000Z",
          state: "active",
        },
        {id: 42, name: "PROJ Sprint 13", state: "future"},
      ],
    },
  };
  registerListSprints(server, async (_method, path) => routes[path]);
  const result = await server.tools.get("list_sprints")({project: "proj"});
  assert.equal(
    result.content[0].text,
    "41 | PROJ Sprint 12 | active | 2026-11-02 to 2026-11-13\n42 | PROJ Sprint 13 | future",
  );
});

test("list_sprints reads every page of boards and sprints", async () => {
  const server = fakeServer();
  const routes = {
    [`${AGILE}/board?projectKeyOrId=PROJ`]: {
      isLast: false,
      values: [{id: 1, type: "kanban"}],
    },
    [`${AGILE}/board?projectKeyOrId=PROJ&startAt=1`]: {
      isLast: true,
      values: [{id: 2, type: "scrum"}],
    },
    [`${AGILE}/board/2/sprint?state=active,future`]: {
      isLast: false,
      values: [{id: 41, name: "S12", state: "active"}],
    },
    [`${AGILE}/board/2/sprint?state=active,future&startAt=1`]: {
      isLast: true,
      values: [{id: 42, name: "S13", state: "future"}],
    },
  };
  registerListSprints(server, async (_method, path) => routes[path]);
  const result = await server.tools.get("list_sprints")({project: "PROJ"});
  assert.equal(result.content[0].text, "41 | S12 | active\n42 | S13 | future");
});
