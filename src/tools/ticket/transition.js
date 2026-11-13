import {z} from "zod";
import {runBatch} from "../../batch.js";
import {defineTool} from "../../define-tool.js";

// Names agents reach for that real workflows spell differently. Each maps to an
// ordered candidate list tried against whatever this issue actually offers, so
// the same alias works on a workflow with "Done" and one with "Closed".
const ALIASES = {
  // No "done" fallback: release notes count Done as shipped.
  cancelled: ["cancelled", "canceled", "won't do", "rejected"],
  closed: ["closed", "done", "resolved", "complete", "completed"],
  complete: ["done", "complete", "completed", "closed"],
  completed: ["done", "completed", "complete", "closed"],
  done: ["done", "closed", "resolved", "complete", "completed"],
  fixed: ["done", "resolved", "fixed", "closed"],
  "in progress": ["in progress", "start progress", "in development", "doing"],
  open: ["open", "to do", "backlog", "re-open"],
  reopen: ["re-open", "reopen", "reopened", "open"],
  reopened: ["re-open", "reopen", "reopened", "open"],
  resolved: ["resolved", "done", "closed", "fixed"],
  "to do": ["to do", "todo", "open", "backlog"],
  todo: ["to do", "todo", "open", "backlog"],
};

// A transition is addressable by its own name ("Resolve") or by the status it
// lands on ("Done"); callers pass a status, so both count as a match.
const namesOf = (t) =>
  [t.name, t.to?.name].filter(Boolean).map((n) => n.toLowerCase());

const label = (t) =>
  t.to?.name && t.to.name !== t.name ? `${t.name} -> ${t.to.name}` : t.name;

const transitionOne = async (jira, ticket_id, status) => {
  const {transitions} = await jira("GET", `/issue/${ticket_id}/transitions`);
  const wanted = status.trim().toLowerCase();
  // "" is a substring of every name, so it would pick the first transition.
  if (!wanted) throw new Error("status is empty");
  const pick = (want) =>
    transitions.find((t) => namesOf(t).some((n) => n === want));
  const match =
    pick(wanted) ||
    (ALIASES[wanted] ?? []).reduce((found, a) => found || pick(a), null) ||
    // Substring last: it is the loosest and would shadow better alias hits.
    transitions.find((t) => namesOf(t).some((n) => n.includes(wanted)));
  if (!match) {
    const available = transitions.map(label).join(", ");
    throw new Error(`Status "${status}" not found. Available: ${available}`);
  }
  await jira("POST", `/issue/${ticket_id}/transitions`, {
    transition: {id: match.id},
  });
  return `${ticket_id} transitioned to "${match.to?.name || match.name}"`;
};

const statusParam = z
  .string()
  .describe('Target status name, e.g. "In Progress", "Done"');

export const registerTransitionTicket = (server, jiraRequest) => {
  defineTool(
    server,
    "transition_ticket",
    {
      description:
        "Change a Jira ticket's status. Matches the transition name or its target status; common aliases (Closed/Resolved -> Done, Reopen -> Re-Open) resolve to whatever the workflow offers. Valid options vary per issue and are listed in the error when no match is found.",
      inputSchema: z.object({
        status: statusParam,
        ticket_id: z.string().describe("Jira issue key, e.g. PROJ-234"),
      }),
    },
    ({ticket_id, status}, jira) => transitionOne(jira, ticket_id, status),
    jiraRequest,
  );

  defineTool(
    server,
    "transition_tickets",
    {
      description:
        "Change the status of several Jira tickets to the same status, with the same matching as transition_ticket. Tickets are processed in order; a failure on one does not stop the rest, and the result lists each ticket's outcome.",
      inputSchema: z.object({
        status: statusParam,
        ticket_ids: z
          .array(z.string())
          .min(1)
          .describe('Issue keys, e.g. ["PROJ-1", "PROJ-2"]'),
      }),
    },
    ({ticket_ids, status}, jira) =>
      runBatch(ticket_ids, (key) => transitionOne(jira, key, status)),
    jiraRequest,
  );
};
