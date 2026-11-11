import {z} from "zod";
import {defineTool} from "../../define-tool.js";

export const registerFindUser = (server, jiraRequest) => {
  defineTool(
    server,
    "find_user",
    {
      description:
        "Find Jira users by part of a username, display name or email. Returns the username that assignee and watcher fields take",
      inputSchema: z.object({
        max_results: z.number().int().min(1).max(50).default(10).optional(),
        query: z
          .string()
          .describe('Part of a name, e.g. "nam" or "Chu Phuong"'),
      }),
    },
    async ({query, max_results = 10}, jira) => {
      const q = query.trim();
      if (!q) throw new Error("query is empty");
      const params = new URLSearchParams({
        maxResults: String(max_results),
        username: q,
      });
      const users = await jira("GET", `/user/search?${params}`);
      if (!users?.length) return `No users match "${q}"`;
      return users
        .map(
          (u) =>
            `${u.name} | ${u.displayName}${u.emailAddress ? ` | ${u.emailAddress}` : ""}${u.active === false ? " (inactive)" : ""}`,
        )
        .join("\n");
    },
    jiraRequest,
  );
};
