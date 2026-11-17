import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {worklogDates, worklogTypes} from "./worklog-pro.js";

// Local "YYYY-MM-DD HH:mm" in the WorklogPRO timezone, the same clock log_work
// writes with, so a day here matches the day the worklog was logged for.
const localStart = (iso) => worklogDates(iso).startDate;

const shiftDay = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const hours = (seconds) => `${+(seconds / 3600).toFixed(2)}h`;

export const registerListWorklogs = (server, jiraRequest) => {
  defineTool(
    server,
    "list_worklogs",
    {
      description:
        "List one user's worklogs on one day across all tickets (default: yours), with worklog IDs, WorklogPRO types as [work/activity] ([no type] when unset) and the day's total. Call it before log_work to avoid logging the same work twice.",
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Day as YYYY-MM-DD (default today)"),
        user: z
          .string()
          .optional()
          .describe(
            "Jira username, as find_user returns it (default: the current user)",
          ),
      }),
    },
    async ({date, user}, jira) => {
      const day = date ?? localStart(new Date().toISOString()).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new Error(`Invalid date "${day}": use YYYY-MM-DD`);
      }
      // Both values go into JQL, so neither may carry a quote.
      if (user !== undefined && !/^[\w.@+-]+$/.test(user)) {
        throw new Error(`Invalid username "${user}": use find_user to get it`);
      }
      const me = user ? null : await jira("GET", "/myself");
      const isAuthor = user
        ? (a) => a?.name?.toLowerCase() === user.toLowerCase()
        : (a) => a?.key === me.key;
      // JQL worklogDate follows the Jira profile timezone, which may differ
      // from JIRA_TIMEZONE, so search a day wider and filter below.
      // shortcut: one page of 100 issues, page through if a day ever spans more.
      const params = new URLSearchParams({
        fields: "summary",
        jql: `worklogAuthor = ${user ? `"${user}"` : "currentUser()"} AND worklogDate >= "${shiftDay(day, -1)}" AND worklogDate <= "${shiftDay(day, 1)}"`,
        maxResults: "100",
      });
      const {issues = []} = (await jira("GET", `/search?${params}`)) ?? {};
      const perIssue = await Promise.all(
        issues.map(async ({key}) => {
          const {worklogs = []} =
            (await jira("GET", `/issue/${key}/worklog`)) ?? {};
          return worklogs
            .filter(
              (w) =>
                isAuthor(w.author) && localStart(w.started).startsWith(day),
            )
            .map((w) => ({...w, key}));
        }),
      );
      const mine = perIssue
        .flat()
        .sort((a, b) => Date.parse(a.started) - Date.parse(b.started));
      const of = user ? ` of ${user}` : "";
      if (!mine.length) return `No worklogs${of} on ${day}`;

      const total = mine.reduce((s, w) => s + (w.timeSpentSeconds || 0), 0);
      const types = await Promise.all(
        mine.map((w) => worklogTypes(jira, w.id)),
      );
      return [
        `Worklogs${of} on ${day}: ${mine.length}, total ${hours(total)}`,
        ...mine.map(
          (w, i) =>
            `  ${w.key} #${w.id} ${localStart(w.started).slice(11)} ${w.timeSpent} ${types[i]}${w.comment ? `: ${w.comment}` : ""}`,
        ),
      ].join("\n");
    },
    jiraRequest,
  );
};
