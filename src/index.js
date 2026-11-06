import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with {type: "json"};
import {registerTools} from "./register.js";

const server = new McpServer({name: "jira-mcp", version: pkg.version});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Jira MCP server v${pkg.version} running on stdio`);
