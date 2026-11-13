import {z} from "zod";
import {runBatch} from "../../batch.js";
import {defineTool} from "../../define-tool.js";

const username = z.string().min(1).describe("Jira username to add");

const addOne = async (jira, ticket_id, name) => {
  // Jira Data Center takes the bare username as a JSON string body.
  await jira("POST", `/issue/${ticket_id}/watchers`, name);
  return `${name} is now watching ${ticket_id}`;
};

export const registerAddWatcher = (server, jiraRequest) => {
  defineTool(
    server,
    "add_watcher",
    {
      description: "Add a user as a watcher of a Jira ticket",
      inputSchema: z.object({
        ticket_id: z.string().describe("Jira issue key, e.g. PROJ-234"),
        // min(1): an empty string is falsy, so jiraRequest would send no body.
        username,
      }),
    },
    ({ticket_id, username}, jira) => addOne(jira, ticket_id, username),
    jiraRequest,
  );
  defineTool(
    server,
    "add_watchers",
    {
      description:
        "Add a user as a watcher of several Jira tickets. Tickets are processed in order; a failure on one does not stop the rest, and the result lists each ticket's outcome.",
      inputSchema: z.object({
        ticket_ids: z
          .array(z.string())
          .min(1)
          .describe('Issue keys, e.g. ["PROJ-1", "PROJ-2"]'),
        username,
      }),
    },
    ({ticket_ids, username}, jira) =>
      runBatch(ticket_ids, (key) => addOne(jira, key, username)),
    jiraRequest,
  );
};
