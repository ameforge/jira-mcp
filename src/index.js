import {
  registerUsageReport,
  withUsage,
} from "@ameforge/atlassian-request/src/usage.js";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with {type: "json"};
import {registerTools} from "./register.js";

const server = new McpServer({name: "jira-mcp", version: pkg.version});

registerTools(withUsage(server, "jira"));
registerUsageReport(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Jira MCP server v${pkg.version} running on stdio`);
