import {writeFile} from "node:fs/promises";
import {basename, join} from "node:path";
import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {jiraDownload} from "../../jira-client.js";

export const registerDownloadAttachment = (
  server,
  jiraRequest,
  download = jiraDownload,
) => {
  defineTool(
    server,
    "download_attachment",
    {
      description:
        "Download a Jira attachment to a local directory, saved under its Jira filename. Attachment IDs are shown by get_ticket in the Attachments line.",
      inputSchema: z.object({
        attachment_id: z.string().describe("Attachment ID, e.g. 10200"),
        dir: z
          .string()
          .describe(
            "Absolute path of an existing directory to save into; a relative path resolves against the server process's working directory, which the MCP client chooses",
          ),
      }),
    },
    async ({attachment_id, dir}, jira) => {
      const a = await jira("GET", `/attachment/${attachment_id}`);
      // basename: the filename comes from Jira and must not escape dir.
      const path = join(dir, basename(a.filename));
      const bytes = Buffer.from(await download(a.content), "base64");
      // wx: never overwrite a local file the user already has.
      await writeFile(path, bytes, {flag: "wx"}).catch((err) => {
        throw new Error(
          err.code === "EEXIST" ? `File already exists: ${path}` : err.message,
        );
      });
      return `Saved ${a.filename} (#${attachment_id}, ${bytes.length} bytes) to ${path}`;
    },
    jiraRequest,
  );
};
