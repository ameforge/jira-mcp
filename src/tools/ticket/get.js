import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {jiraDownload} from "../../jira-client.js";
import {START_DATE_FIELD} from "../../ticket-fields.js";
import {worklogTypes} from "../worklog/worklog-pro.js";

// Only formats MCP clients can render as images; SVG and the rest stay name-only.
const IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const IMAGE_LIMIT = 5;
// Past 20 images in one request, Claude applies a stricter per-image limit.
export const IMAGE_LIMIT_MAX = 20;
// Claude caps base64 at 5 MB per image on Bedrock and Google Cloud; images resend on every later turn.
const IMAGE_MAX_B64 = 5_000_000;
const IMAGES_TOTAL_B64 = 10_000_000;
const b64Size = (bytes) => Math.ceil(bytes / 3) * 4;

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

export const fetchImages = async (attachments, download, limit) => {
  const images = attachments.filter((a) => IMAGE_TYPES.has(a.mimeType));
  const picked = [];
  // Named so the caller knows which screenshot it missed and that raising image_limit won't bring it back.
  const skipped = [];
  let overLimit = 0;
  let budget = IMAGES_TOTAL_B64;
  for (const a of images) {
    const size = b64Size(a.size);
    if (picked.length === limit) overLimit++;
    else if (size > IMAGE_MAX_B64)
      skipped.push(`  ${a.filename}: not shown, too large (${mb(a.size)})`);
    else if (size > budget)
      skipped.push(`  ${a.filename}: not shown, total size cap reached`);
    else {
      picked.push(a);
      budget -= size;
    }
  }
  const results = await Promise.allSettled(
    picked.map((a) => download(a.content)),
  );
  const blocks = [];
  const notes = [];
  results.forEach((r, i) => {
    const a = picked[i];
    if (r.status === "fulfilled") {
      notes.push(`  [image ${blocks.length + 1}] ${a.filename}`);
      blocks.push({data: r.value, mimeType: a.mimeType, type: "image"});
    } else notes.push(`  ${a.filename}: download failed (${r.reason.message})`);
  });
  notes.push(...skipped);
  if (overLimit)
    notes.push(`  ${overLimit} more image(s) not shown (max ${limit} images)`);
  return {blocks, notes};
};

// A busy ticket carries hundreds of comments; the newest are the ones that answer questions.
const COMMENT_LIMIT = 20;

const formatComments = ({comments = [], total = 0} = {}) => {
  if (!comments.length) return "Comments: None";
  const shown = comments.slice(-COMMENT_LIMIT);
  const body = shown
    .map(
      (c) =>
        `  #${c.id} [${c.created?.slice(0, 10)}] ${c.author?.displayName || "Unknown"}: ${c.body}`,
    )
    .join("\n");
  // Jira can also cap the inline list, so trust its total over what arrived.
  const all = Math.max(total, comments.length);
  const count =
    shown.length < all ? `${shown.length} most recent of ${all}` : all;
  return `Comments (${count}):\n${body}`;
};

// The newest worklogs are the ones people come to fix.
const formatWorklogs = async (jira, {worklogs = [], total = 0} = {}) => {
  if (!worklogs.length) return "Worklogs: None";
  const shown = worklogs.slice(-COMMENT_LIMIT);
  const types = await Promise.all(shown.map((w) => worklogTypes(jira, w.id)));
  const body = shown
    .map(
      (w, i) =>
        `  #${w.id} [${w.started?.slice(0, 10)}] ${w.author?.displayName || "Unknown"} ${w.timeSpent} ${types[i]}${w.comment ? `: ${w.comment}` : ""}`,
    )
    .join("\n");
  const all = Math.max(total, worklogs.length);
  const count =
    shown.length < all ? `${shown.length} most recent of ${all}` : all;
  return `Worklogs (${count}):\n${body}`;
};

export const registerGetTicket = (
  server,
  jiraRequest,
  download = jiraDownload,
) => {
  defineTool(
    server,
    "get_ticket",
    {
      description:
        "Get full details of a Jira ticket by its key. For a single comment (a ?focusedCommentId= link), use get_comment instead.",
      inputSchema: z.object({
        image_limit: z
          .number()
          .int()
          .min(1)
          .max(IMAGE_LIMIT_MAX)
          .optional()
          .describe(
            `Max images to return with include_images (default ${IMAGE_LIMIT}, max ${IMAGE_LIMIT_MAX}); the total size cap still applies`,
          ),
        include_comments: z
          .boolean()
          .optional()
          .describe("Include the ticket's comments (default false)"),
        include_images: z
          .boolean()
          .optional()
          .describe(
            "Return image attachments (screenshots referenced as !name.png! in the description/comments) as viewable images (default false)",
          ),
        include_worklogs: z
          .boolean()
          .optional()
          .describe(
            "Include the ticket's worklogs with their IDs and WorklogPRO types (default false; one extra request plus one per worklog shown)",
          ),
        ticket_id: z.string().describe("Jira issue key, e.g. PROJ-234"),
      }),
    },
    async (
      {
        ticket_id,
        include_comments,
        include_images,
        include_worklogs,
        image_limit,
      },
      jira,
    ) => {
      // Without ?fields= Jira returns every field, inline comments and worklogs included.
      const fields = [
        "summary,status,assignee,reporter,priority,duedate,timetracking",
        `labels,description,subtasks,attachment,${START_DATE_FIELD}`,
        include_comments ? "comment" : null,
      ]
        .filter(Boolean)
        .join(",");
      const issue = await jira("GET", `/issue/${ticket_id}?fields=${fields}`);
      const f = issue.fields;
      const subtasks = (f.subtasks || [])
        .map((s) => `  - ${s.key}: ${s.fields.summary}`)
        .join("\n");
      // Unset fields are omitted, not printed as "Not set": the caller pays tokens for every line.
      const line = (label, value) => (value ? `${label}: ${value}` : null);
      const attachments = f.attachment || [];
      const images = include_images
        ? await fetchImages(attachments, download, image_limit ?? IMAGE_LIMIT)
        : {blocks: [], notes: []};
      // Jira caps the inline worklog field and may drop the newest, so read the list from its endpoint.
      const worklogs = include_worklogs
        ? await formatWorklogs(
            jira,
            (await jira("GET", `/issue/${ticket_id}/worklog`)) ?? {},
          )
        : null;
      const text = [
        `Key: ${issue.key}`,
        `Summary: ${f.summary}`,
        `Status: ${f.status?.name}`,
        `Assignee: ${f.assignee?.displayName || "Unassigned"}`,
        line("Reporter", f.reporter?.displayName),
        line("Priority", f.priority?.name),
        line("Start Date", f[START_DATE_FIELD]),
        line("Due Date", f.duedate),
        line("Original Estimate", f.timetracking?.originalEstimate),
        line("Labels", (f.labels || []).join(", ")),
        f.description ? `Description:\n${f.description}` : null,
        subtasks ? `Subtasks:\n${subtasks}` : null,
        include_comments ? formatComments(f.comment) : null,
        worklogs,
        line(
          "Attachments",
          attachments.map((a) => `${a.filename} (#${a.id})`).join(", "),
        ),
        images.notes.length ? `Images:\n${images.notes.join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (!images.blocks.length) return text;
      return [{text, type: "text"}, ...images.blocks];
    },
    jiraRequest,
  );
};
