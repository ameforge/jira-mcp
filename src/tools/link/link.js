import {z} from "zod";
import {runBatch} from "../../batch.js";
import {defineTool} from "../../define-tool.js";
import {namesOf} from "./unlink.js";

const inwardIssue = z
  .string()
  .describe("Issue key being linked FROM, e.g. PROJ-1");

const linkType = z
  .string()
  .default("Blocks")
  .describe(
    'Link type name or verb, e.g. "Blocks", "Relates", "is blocked by"',
  );

// The schema default does not run for a caller that skips validation.
const resolveLinkType = async (jira, text = "Blocks") => {
  const want = text.trim().toLowerCase();
  const {issueLinkTypes} = await jira("GET", "/issueLinkType");
  const at = (i) => issueLinkTypes.find((t) => namesOf(t)[i] === want);
  const type = at(0) ?? at(2);
  if (type) return {swap: false, type};
  const inward = at(1);
  if (inward) return {swap: true, type: inward};
  throw new Error(
    `Unknown link type "${text}". Valid link types: ${issueLinkTypes.map((t) => t.name).join(", ")}`,
  );
};

const linkOne = async (jira, a, b, {swap, type}) => {
  const [from, to] = swap ? [b, a] : [a, b];
  await jira("POST", "/issueLink", {
    inwardIssue: {key: from},
    outwardIssue: {key: to},
    type: {name: type.name},
  });
  return `Linked: ${from} ${type.outward} ${to} (${type.name})`;
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
    async ({inward_issue, outward_issue, link_type}, jira) =>
      linkOne(
        jira,
        inward_issue,
        outward_issue,
        await resolveLinkType(jira, link_type),
      ),
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
    async ({inward_issue, outward_issues, link_type}, jira) => {
      const resolved = await resolveLinkType(jira, link_type);
      return runBatch(outward_issues, (key) =>
        linkOne(jira, inward_issue, key, resolved),
      );
    },
    jiraRequest,
  );
};
