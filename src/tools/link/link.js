import {z} from "zod";
import {runBatch} from "../../batch.js";
import {defineTool} from "../../define-tool.js";
import {withLinkTypes} from "../../valid-names.js";

const inwardIssue = z
  .string()
  .describe("Issue key being linked FROM, e.g. PROJ-1");

const linkType = z
  .string()
  .default("Blocks")
  .describe("Link type: Blocks, Clones, Relates to, Duplicate, etc.");

const linkOne = async (jira, inward_issue, outward_issue, link_type) => {
  await withLinkTypes(
    () =>
      jira("POST", "/issueLink", {
        inwardIssue: {key: inward_issue},
        outwardIssue: {key: outward_issue},
        type: {name: link_type},
      }),
    jira,
  );
  return `Linked: ${inward_issue} "${link_type}" ${outward_issue}`;
};

export const registerLinkIssues = (server, jiraRequest) => {
  defineTool(
    server,
    "link_issues",
    {
      description: "Create a link between two Jira tickets",
      inputSchema: z.object({
        inward_issue: inwardIssue,
        link_type: linkType,
        outward_issue: z
          .string()
          .describe("Issue key being linked TO, e.g. PROJ-2"),
      }),
    },
    ({inward_issue, outward_issue, link_type}, jira) =>
      linkOne(jira, inward_issue, outward_issue, link_type),
    jiraRequest,
  );

  defineTool(
    server,
    "link_tickets",
    {
      description:
        "Link one Jira ticket to several others with the same link type. Links are created in order; a failure on one does not stop the rest, and the result lists each link's outcome.",
      inputSchema: z.object({
        inward_issue: inwardIssue,
        link_type: linkType,
        outward_issues: z
          .array(z.string())
          .min(1)
          .describe('Issue keys being linked TO, e.g. ["PROJ-2", "PROJ-3"]'),
      }),
    },
    // The schema default does not run for a caller that skips validation.
    ({inward_issue, outward_issues, link_type = "Blocks"}, jira) =>
      runBatch(outward_issues, (key) =>
        linkOne(jira, inward_issue, key, link_type),
      ),
    jiraRequest,
  );
};
