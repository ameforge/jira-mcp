# Jira mcp

MCP server for Jira Server/Data Center (REST API v2). It lets an AI assistant such as Claude Code or Claude Desktop read and write your Jira.

## Requirements

- A Jira Server/Data Center account (username + password).
- Node.js 18+.

## Quick start

You can let Claude Code install it for you. Paste this prompt into a Claude Code session and replace the values with your own:

```text
Add the MCP server "g-jira-mcp" with `claude mcp add`, running `npx -y g-jira-mcp@latest`, with these environment variables:
JIRA_HOST=https://jira.company.com
JIRA_USERNAME=your_username
JIRA_PASSWORD=your_password
Use the command syntax for my shell, then run `claude mcp list` to check that it connects.
```

The prompt puts your password into the conversation. If you would rather keep it out, run the command below yourself, in a regular terminal rather than a Claude Code session. Either way, restart Claude Code afterwards so it loads the server.

Pick the block for your shell, since each one continues lines differently.

bash / zsh (macOS, Linux, Git Bash or WSL on Windows):

```bash
claude mcp add g-jira-mcp \
  -e JIRA_HOST="https://jira.company.com" \
  -e JIRA_USERNAME="your_username" \
  -e JIRA_PASSWORD="your_password" \
  -- npx -y g-jira-mcp@latest
```

PowerShell (Windows):

```powershell
claude mcp add g-jira-mcp `
  -e JIRA_HOST="https://jira.company.com" `
  -e JIRA_USERNAME="your_username" `
  -e JIRA_PASSWORD="your_password" `
  -- npx -y g-jira-mcp@latest
```

Command Prompt (cmd.exe): put the whole command on one line, or end each line with `^` instead of `\`.

Or manually add to `.claude/settings.json` (or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "g-jira-mcp": {
      "command": "npx",
      "args": ["-y", "g-jira-mcp@latest"],
      "env": {
        "JIRA_HOST": "https://jira.company.com",
        "JIRA_USERNAME": "your_username",
        "JIRA_PASSWORD": "your_password"
      }
    }
  }
}
```

Restart Claude Code/Desktop after editing the config.

To check that it connected, run `/mcp` inside Claude Code, or `claude mcp list` in a terminal.

Official setup guides:

- Claude Code: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) explains `claude mcp add`, the local, project and user scopes, and the shared `.mcp.json` file.
- Claude Desktop: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) shows, with screenshots, how to open `claude_desktop_config.json` from Settings, Developer, Edit Config, and where to find the logs when a server does not start.

## Environment variables

| Variable                | Required | Description                                                     |
| ----------------------- | -------- | --------------------------------------------------------------- |
| `ATLASSIAN_MCP_USAGE`   | no       | Set to `off` to turn off the local usage log (see Usage log)    |
| `ATLASSIAN_MCP_TOOLS`   | no       | Comma-separated tool or package names to expose (default all)   |
| `JIRA_HOST`             | yes      | Base URL, e.g. `https://jira.company.com`                       |
| `JIRA_USERNAME`         | yes*     | Jira username; `ATLASSIAN_USERNAME` is read when it is unset    |
| `JIRA_PASSWORD`         | yes*     | Jira password; `ATLASSIAN_PASSWORD` is read when it is unset    |
| `JIRA_TOKEN`            | no       | Personal Access Token; when set, replaces username/password (*) |
| `JIRA_START_DATE_FIELD` | no       | Custom field ID for "Start date" (default `customfield_11300`)  |
| `JIRA_EPIC_LINK_FIELD`  | no       | Custom field ID for "Epic Link" (default `customfield_10001`)   |
| `JIRA_TIMEZONE`         | no       | Timezone for WorklogPRO form (default: this machine's timezone) |

To discover custom field IDs on your instance:

```bash
curl -u user:pass https://jira.company.com/rest/api/2/field | jq '.[] | select(.name | test("story|point|start"; "i")) | {id, name}'
```

## Tools

| Tool                     | Description                                                                                                                                                                                                                                  | Key parameters                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_ticket`             | Get full details of a Jira ticket by its key; for a single comment use `get_comment`                                                                                                                                                         | `ticket_id`, optional: `include_comments`, `include_images`, `include_worklogs`, `image_limit`                                                                                                   |
| `search_tickets`         | Search Jira tickets using JQL query language                                                                                                                                                                                                 | `jql`, `max_results` (optional, default 25)                                                                                                                                                      |
| `create_ticket`          | Create a new Jira ticket                                                                                                                                                                                                                     | `project`, `summary`, `issue_type`, optional: `assignee`, `body`, `parent_key`, `due_date`, `start_date`, `original_estimate`, `labels`                                                          |
| `update_ticket`          | Update fields of a Jira ticket                                                                                                                                                                                                               | `ticket_id`, optional: `summary`, `description`, `issue_type`, `parent_key`, `epic_key`, `labels`, `due_date`, `start_date`, `original_estimate`, `implementation_notes`, `assignee`, `priority` |
| `update_tickets`         | Apply the same values to several tickets; one failure does not stop the rest, and any failure returns an error listing each outcome. No `summary`, `description`, `implementation_notes`, `issue_type` or `parent_key` (use `update_ticket`) | `ticket_ids`, optional: `assignee`, `priority`, `labels`, `due_date`, `start_date`, `original_estimate`, `epic_key`                                                                              |
| `transition_ticket`      | Change a Jira ticket's status by name, alias-aware                                                                                                                                                                                           | `ticket_id`, `status`                                                                                                                                                                            |
| `transition_tickets`     | Change several tickets to the same status, same matching as `transition_ticket`; one failure does not stop the rest, and any failure returns an error listing each outcome                                                                   | `ticket_ids`, `status`                                                                                                                                                                           |
| `add_comment`            | Add a comment to a Jira ticket                                                                                                                                                                                                               | `ticket_id`, `body`                                                                                                                                                                              |
| `update_comment`         | Replace the text of an existing comment (IDs come from `get_ticket` with `include_comments`)                                                                                                                                                 | `ticket_id`, `comment_id`, `body`                                                                                                                                                                |
| `delete_comment`         | Delete a comment from a Jira ticket (cannot be undone)                                                                                                                                                                                       | `ticket_id`, `comment_id`                                                                                                                                                                        |
| `get_comment`            | Get one comment by ID, e.g. from a focusedCommentId link; cheaper than get_ticket                                                                                                                                                            | `ticket_id`, `comment_id`, optional: `include_images`                                                                                                                                            |
| `list_worklogs`          | List one user's worklogs on one day across all tickets (default: yours), with IDs and the day's total; check it before `log_work`                                                                                                            | optional: `date` (YYYY-MM-DD, default today), `user`                                                                                                                                             |
| `log_work`               | Log work (time) on a Jira ticket, optionally setting WorklogPRO Type of Work and Type of Activity                                                                                                                                            | `ticket_id`, `time_spent`, optional: `comment`, `started`, `work_type`, `activity`                                                                                                               |
| `update_worklog`         | Edit a worklog's time, start or comment (IDs come from `get_ticket` with `include_worklogs`)                                                                                                                                                 | `ticket_id`, `worklog_id`, optional: `time_spent`, `started`, `comment`                                                                                                                          |
| `delete_worklog`         | Delete a worklog from a Jira ticket (cannot be undone)                                                                                                                                                                                       | `ticket_id`, `worklog_id`                                                                                                                                                                        |
| `link_issues`            | Create a link between two Jira tickets                                                                                                                                                                                                       | `inward_issue`, `outward_issue`, optional: `link_type` (default "Blocks")                                                                                                                        |
| `link_tickets`           | Link one ticket to several others with the same link type; one failure does not stop the rest, and any failure returns an error listing each outcome                                                                                         | `inward_issue`, `outward_issues`, optional: `link_type` (default Blocks)                                                                                                                         |
| `unlink_issues`          | Remove a link between two Jira tickets (either direction)                                                                                                                                                                                    | `ticket_id`, `linked_ticket_id`, optional: `link_type` (required when several links connect them)                                                                                                |
| `add_watcher`            | Add a user as a watcher of a Jira ticket                                                                                                                                                                                                     | `ticket_id`, `username`                                                                                                                                                                          |
| `add_watchers`           | Add a user as a watcher of several tickets; one failure does not stop the rest, and any failure returns an error listing each outcome                                                                                                        | `ticket_ids`, `username`                                                                                                                                                                         |
| `remove_watcher`         | Remove a user from the watchers of a Jira ticket                                                                                                                                                                                             | `ticket_id`, `username`                                                                                                                                                                          |
| `move_to_sprint`         | Move tickets into an active or future sprint                                                                                                                                                                                                 | `ticket_ids`, `sprint` (name or ID)                                                                                                                                                              |
| `list_sprints`           | List the active and future sprints of a project, with their IDs                                                                                                                                                                              | `project`                                                                                                                                                                                        |
| `find_user`              | Find users by part of a username, display name or email; returns the username                                                                                                                                                                | `query`, `max_results`                                                                                                                                                                           |
| `add_attachment`         | Upload a local file to a Jira ticket as an attachment                                                                                                                                                                                        | `ticket_id`, `file_path` (absolute)                                                                                                                                                              |
| `delete_attachment`      | Delete an attachment from Jira (cannot be undone; IDs come from `get_ticket`)                                                                                                                                                                | `attachment_id`                                                                                                                                                                                  |
| `download_attachment`    | Download a Jira attachment into a local directory (never overwrites; IDs come from `get_ticket`)                                                                                                                                             | `attachment_id`, `dir` (absolute)                                                                                                                                                                |
| `generate_release_notes` | Generate Markdown release notes for a fix version, grouped by issue type                                                                                                                                                                     | `fix_version`, optional: `project`                                                                                                                                                               |
| `usage_report`           | Done, calls and errors from the local usage log, per package and tool; with `format` set to `html`, also writes and opens a board page                                                                                                       | optional: `days` (default 30), `format` (`text` or `html`)                                                                                                                                       |

### Notes

- Jira Server stores descriptions as plain text, not in the ADF format.
- `get_ticket` omits unset fields rather than printing placeholder text. Key, Summary, Status and Assignee are always present (Assignee shows "Unassigned" when empty); other fields appear only when set. Pass `include_comments=true` to append the ticket's comment thread (`Comments: None` when it has none); comments are off by default to keep output small and save tokens. The same Jira request fetches everything, so including comments costs no extra API call. Comments are capped at 20 most recent; if a ticket has more, the header reads `Comments (20 most recent of 45):` so the caller knows older comments exist and can open the ticket in Jira to see them. Each comment line starts with its ID (`#10001`), which `update_comment` and `delete_comment` take.
- `get_ticket` lists attachments as `name (#id)` in an `Attachments:` line whenever the ticket has any. Pass `include_images=true` to also receive image attachments (PNG, JPEG, GIF, WebP) as MCP image content, so the caller can see screenshots referenced as `!image.png!` in the description or comments. Images are off by default because each one costs far more tokens than the text. At most 5 images are returned by default (raise it with `image_limit`, up to 20), each up to about 3.7 MB and about 7.5 MB in total, so the response stays inside Claude's vision limits (5 MB base64 per image on Bedrock and Google Cloud, 32 MB per request). Images are sent as-is; the model API downscales large ones itself. Each image costs one extra download request; an `Images:` section maps `[image N]` to its file name, reports each skipped image with its reason (too large or total size cap reached), reports failed downloads, and when `image_limit` is hit, says how many images were left out. Raising `image_limit` brings back only images that hit the count limit; images skipped for size will not reappear.
- `get_comment` returns a single comment as `#id [date] author: body`. Pass `include_images=true` to fetch and return only the image attachments that comment embeds via `!filename.png!` or `!filename.png|width=…!` markup (by contrast, `get_ticket` returns all images on the ticket). Fetching attachments costs one extra request only when the comment embeds something. Images follow the same per-image and total size limits as `get_ticket`, up to 20 max. Use `get_comment` instead of `get_ticket` for `?focusedCommentId=` links, or when only a single comment matters.
- `search_tickets` output is adaptive: empty columns (no value anywhere) are dropped entirely, and constant columns (same value on every row, when there are 3+ rows) are stated once in the header as `All: Status=In Progress` and removed from the table. When columns are dropped, the header also notes which ones were empty across all results (e.g. `Unset for every row: Priority, Parent, Start Date`) so the caller can tell "no ticket has a due date" from "this tool doesn't return due dates". KEY and Summary are always kept. The header's `Found N issue(s) (showing M)` reports when the result was truncated; raise `max_results` above the default 25 to see more.
- `create_ticket` and `update_ticket` both accept an `assignee` parameter (Jira username as a string, sent as `{name: assignee}`). In `create_ticket`, an empty assignee value is ignored. In `update_ticket`, pass `assignee=""` to unassign.
- `create_ticket` applies `original_estimate` in a follow-up PUT rather than in the create payload: Jira Data Center answers a bare `500 Internal server error` when `timetracking` is present in `POST /issue`, while the same value applies cleanly as an update afterwards. The ticket key is reported even if that second call fails, with a warning to set the estimate via `update_ticket`, so a failed estimate never leads you to create the ticket twice.
- `duedate` is a standard field (`YYYY-MM-DD`); "Start date" is a custom field, configurable via `JIRA_START_DATE_FIELD`.
- `update_ticket`'s `epic_key` sets the Epic Link field (a custom field, configurable via `JIRA_EPIC_LINK_FIELD`, default `customfield_10001`) so the ticket shows under the epic's "Issues in Epic" panel. This differs from `link_issues`, which only creates a generic Linked Issue (e.g. "Relates"). Epic Link can only be set on standard issue types (Story/Task/Bug), not on Sub-tasks or Epics themselves.
- `search_tickets` uses JQL syntax, e.g. `project = PROJ AND status = 'In Progress'`.
- `add_attachment` uploads one local file and returns its attachment ID. Pass an absolute `file_path`: a relative path resolves against the server process working directory, which the MCP client chooses. To show an uploaded image inline, reference it as `!filename.png!` in a comment or description. The server can read any file its user can read, so check the path before you approve the call.
- `move_to_sprint` takes a sprint name or numeric ID. A name is looked up among the active and future sprints of the scrum boards of the first ticket's project (Agile API, `/rest/agile/1.0`); if it matches none, or several, nothing is moved and the error lists the open sprints with their IDs. To list a sprint's tickets, use `search_tickets` with JQL such as `sprint = "PROJ Sprint 12"` or `sprint in openSprints()`.
- `transition_ticket` resolves the transition ID automatically, matching either the transition's own name ("Resolve Issue") or the status it lands on ("Done"). Common aliases map onto whatever the workflow actually offers (Closed/Resolved/Complete → Done, Reopen → Re-Open, Todo → To Do, Cancelled → Won't Do), so the same call works across workflows with different status names. Exact matches win, then aliases, then a substring fallback; when the substring fits more than one transition, nothing is posted and the error lists the candidates. When nothing matches, the error lists every valid option for that issue as `Transition -> Target Status`, or only the name when the two are the same; the tool description cannot list them because they vary per issue and workflow.
- When Jira rejects an unknown issue type (`create_ticket`, `update_ticket`, `search_tickets`), the error also lists the valid names: the project's issue types when the project is known, and every issue type for a JQL search. `link_issues` and `link_tickets` check the link type before they post anything, and an unknown one fails with a list of every link type.
- `update_ticket` only changes the fields you pass; omit a field to keep its current value. Pass `assignee=""` to unassign, and `due_date=""` or `start_date=""` to clear a date. `implementation_notes` appends to the description. Jira's REST API ignores a parent change on an existing sub-task, and rejects or ignores an issue type change to or from a sub-task type, so `update_ticket` makes those through the same Move/Convert wizards the Jira UI uses: sub-task to standard type, standard type to sub-task (needs `parent_key`), between sub-task types, and a new parent for a sub-task. It stops, changing nothing, when the new type's workflow lacks the ticket's current status (the error lists the statuses to pick from in the Jira UI), needs a required field, or would delete field values (pass `allow_field_loss: true` to accept that loss). A change between two standard types that REST does not apply still needs the Jira UI "Move" action.
- `log_work` advertises one canonical name per work type (code, deploy, design, management, meeting, misc, operation, qa, req, research, translation) and per activity (correct, create, review) so its schema stays small; every alias still works as input (coding, dev, testing, ops, requirement, other, and the rest). "fix" is an activity alias (Correction), not a work type. The form shows Type of Work and Type of Activity as two independent dropdowns, so any work type pairs with any activity. `activity` is required when `work_type` is set, and `comment` is required whenever `work_type` or `activity` is set, because the WorklogPRO form rejects an empty Work Description. When the form rejects a submit, the error carries the form's own message and nothing is logged. If neither is set, logs via plain REST (no WorklogPRO form). If `work_type` or `activity` is set and the WorklogPRO form is unavailable, nothing is logged and the call fails (safe to retry); it never falls back to REST, which cannot set those attributes. A failed form submit is an error and is never retried, because the worklog may already exist. When `work_type` or `activity` is set, the start time is written in `JIRA_TIMEZONE`, or in this machine's timezone when it is unset, so set it to the Jira server's timezone when the two differ.
- `list_worklogs` lists one user's worklogs for a day across every ticket, each line with ticket key, worklog ID, start time, time spent and comment, plus the day's total. Without `user` it reads your own worklogs; `user` takes a Jira username as `find_user` returns it, matched without regard to case. The day is taken in `JIRA_TIMEZONE` (this machine's timezone when it is unset), the same one `log_work` uses, so a worklog started at 06:30 local time counts for that local day. It finds tickets with a JQL `worklogAuthor` and `worklogDate` search one day wider on each side, then reads each ticket's worklogs (one request per ticket, up to 100 tickets per day). Each line also shows the WorklogPRO Type of Work and Type of Activity as `[work/activity]`, named by the aliases `log_work` takes (for example `[research/create]`), read from the WorklogPRO REST API with one request per worklog. `[no type]` means either type is unset, and `[type unknown]` means they could not be read (for example on a Jira without WorklogPRO).
- `get_ticket` with `include_worklogs=true` appends the ticket's worklogs, each line starting with its ID (`#20001`), which `update_worklog` and `delete_worklog` take, and showing its WorklogPRO types the same way as `list_worklogs`. This costs one extra request (`GET /issue/{key}/worklog`) plus one WorklogPRO request per worklog shown, capped at the 20 most recent like comments. `log_work` returns no ID when it goes through the WorklogPRO form, so this is where to find it. `update_worklog` edits time, start and comment over REST only; to change Type of Work or Type of Activity, delete the worklog and log it again with `log_work`.
- `generate_release_notes` groups tickets by type into Features / Improvements / Bug Fixes / Other.
- Register the server as `g-jira-mcp` and use that key in every project. The key becomes the tool prefix (`mcp__g-jira-mcp__get_ticket`), so a project that registers it under a different name exposes different tool names. An agent used to one name gets `No such tool available` in a project configured with the other.
- Transient Jira failures (429, 500, 502, 503, 504) are retried up to twice with a 250ms/500ms backoff. Only GET and PUT are replayed. A POST that returned 500 may already have created the comment, worklog or transition, so it fails fast instead of risking a duplicate, and a DELETE that returned 500 may already have gone through, so a replay would report a 404. A request Jira does not answer within 30 seconds fails; for a POST or DELETE, including a WorklogPRO form submit, the error says the write may already be saved and must not be retried before checking Jira. Retries cover REST calls only: attachment uploads and downloads (`add_attachment`, `download_attachment` and the images of `get_ticket` and `get_comment`) and the Jira web forms are never retried. An attachment download fails when Jira sends no response within 30 seconds, but a download that has started is not cut off; uploads have no timeout, because a large file may take longer.
- All logs go to stderr; stdout is reserved for the MCP protocol.

## Usage log

Every tool call except `usage_report` is logged to a local file with the time, the package, the tool name and whether the call succeeded. Arguments and content are never logged, and nothing is sent anywhere. All the Atlassian packages share this one file.

The file is `$XDG_CONFIG_HOME/atlassian-mcp/usage.jsonl` when `XDG_CONFIG_HOME` is set. Otherwise it is `%APPDATA%\atlassian-mcp\usage.jsonl` on Windows and `~/.config/atlassian-mcp/usage.jsonl` elsewhere. Set `ATLASSIAN_MCP_USAGE=off` to stop logging. A log that cannot be written never fails a tool call.

Call the `usage_report` tool to read the log. Its optional parameters are:

- `days`: how many days back to count (default 30).
- `format`: `text` (default) gives a summary per package and tool. `html` also writes `board.html` next to the log and opens it in the browser. The board has range buttons for 7, 30 and 90 days, for `days` when it is another number, and for all time, totals for done, calls and errors, a done per day chart, a table per tool and a Share card button that shows a card you can download as a PNG or copy.

Done counts the write calls that succeeded. Read tools are those whose names start with `get_`, `list_`, `search_`, `find_`, `download_`, `generate_` or `compare_`. Every other tool counts as a write. Because the file is shared, the report also counts calls made through the other packages.

## Example prompts

- "Search tickets in project PROJ that are In Progress"
- "Create a Story in PROJ titled 'Release notes v2.0' due 2026-08-01"
- "Update PROJ-234, set the assignee to namcp and add label BugFix"
- "Add a comment to PROJ-234: 'Review done'"
- "Generate release notes for fix version v2.4 in project PROJ"

## Troubleshooting

- 401/403: recheck `JIRA_TOKEN` when it is set, otherwise `JIRA_USERNAME`/`JIRA_PASSWORD`, and whether the account can access the project.
- Connection/timeout: verify that `JIRA_HOST` includes the scheme (`https://`), and whether VPN/internal network is required.
- "Jira sent the form to ..., which is not JIRA_HOST": changing an issue type, moving a sub-task or `log_work` with a work type or activity uses Jira's web forms, which only talk to `JIRA_HOST`. Set it to the exact address your browser shows for Jira, including `https://`.
- Start date not saving: confirm `JIRA_START_DATE_FIELD` matches your instance (see the discovery command above).
- Error logs: every failed tool call except `usage_report` is written to stderr with a timestamp and the tool name, and the startup line shows the server version. On Windows, Claude Code keeps this in `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<project>\mcp-logs-<server name>\` (for example `mcp-logs-g-jira-mcp`).
- Reporting a bug: open an issue at <https://github.com/ameforge/atlassian-mcp/issues> with the server version, the tool you called and the matching log lines. Logs can contain ticket content and internal URLs, so remove anything sensitive before you post. Nothing is sent anywhere automatically.

## Development

```bash
pnpm install
cp .env.example .env   # edit with your credentials
pnpm build             # bundle to dist/index.js via rsbuild
pnpm test
```

Release from the repo root with `pnpm release:jira`; see [docs/RELEASE.md](https://github.com/ameforge/atlassian-mcp/blob/main/docs/RELEASE.md).

## Support

Questions or issues? Email [PNam](mailto:pnamhn16@gmail.com).

If this project helps you, consider buying me a coffee:

<img src="https://raw.githubusercontent.com/ameforge/atlassian-mcp/main/docs/buy-me-a-coffee.jpg" alt="Buy Me A Coffee" width="300">

---

Created by [PNam](mailto:pnamhn16@gmail.com)
