import {readFile, stat} from "node:fs/promises";
import {basename} from "node:path";
import {z} from "zod";
import {defineTool} from "../../define-tool.js";
import {jiraUpload} from "../../jira-client.js";

export const registerAddAttachment = (server, upload = jiraUpload) => {
  defineTool(
    server,
    "add_attachment",
    {
      description:
        "Upload a local file to a Jira ticket as an attachment. Embed an uploaded image in a comment or description with !filename.png!",
      inputSchema: z.object({
        file_path: z
          .string()
          .describe(
            "Absolute path of the file to upload; a relative path resolves against the server process's working directory, which the MCP client chooses",
          ),
        ticket_id: z.string().describe("Jira issue key, e.g. PROJ-234"),
      }),
    },
    async ({ticket_id, file_path}) => {
      const info = await stat(file_path).catch(() => null);
      if (!info?.isFile()) throw new Error(`Not a file: ${file_path}`);
      const [a] = await upload(
        ticket_id,
        basename(file_path),
        await readFile(file_path),
      );
      return `Attached ${a.filename} (#${a.id}, ${a.size} bytes) to ${ticket_id}`;
    },
  );
};
