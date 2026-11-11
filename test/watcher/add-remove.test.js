import {registerAddWatcher} from "../../src/tools/watcher/add.js";
import {registerRemoveWatcher} from "../../src/tools/watcher/remove.js";
import {testRequests} from "../helpers/fake-server.js";

testRequests([
  [
    registerAddWatcher,
    "add_watcher",
    {ticket_id: "PROJ-1", username: "jdoe"},
    ["POST", "/issue/PROJ-1/watchers", "jdoe"],
  ],
  [
    registerRemoveWatcher,
    "remove_watcher",
    {ticket_id: "PROJ-1", username: "j.doe@corp"},
    ["DELETE", "/issue/PROJ-1/watchers?username=j.doe%40corp"],
  ],
]);
