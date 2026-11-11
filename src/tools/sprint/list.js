import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {openSprints} from "./move.js";

export const registerListSprints = (server, jiraRequest) => {
  defineTool(
    server,
    "list_sprints",
    {
      description:
        "List the active and future sprints of a project's scrum boards, with the IDs move_to_sprint takes",
      inputSchema: z.object({
        project: z.string().describe("Project key, e.g. PROJ"),
      }),
    },
    async ({project}, jira) => {
      const key = project.trim().toUpperCase();
      const sprints = await openSprints(jira, key);
      if (!sprints.length) return `No active or future sprints in ${key}`;
      const day = (d) => d?.slice(0, 10);
      return sprints
        .map(
          (s) =>
            `${s.id} | ${s.name} | ${s.state}` +
            (s.startDate ? ` | ${day(s.startDate)} to ${day(s.endDate)}` : "") +
            (s.goal ? ` | goal: ${s.goal}` : ""),
        )
        .join("\n");
    },
    jiraRequest,
  );
};
