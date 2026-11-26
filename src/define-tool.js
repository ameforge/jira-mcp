import {jiraRequest as defaultJiraRequest} from "./jira-client.js";

// jiraRequest is a parameter, not only an import, so tests can pass a fake Jira.
export const defineTool = (
  server,
  name,
  config,
  handler,
  jiraRequest = defaultJiraRequest,
) => {
  server.registerTool(name, config, async (params) => {
    try {
      const out = await handler(params, jiraRequest);
      return {
        content: Array.isArray(out) ? out : [{text: out, type: "text"}],
      };
    } catch (err) {
      // stderr, because stdout carries the MCP protocol.
      console.error(
        `[${new Date().toISOString()}] ${name} failed: ${err.message}`,
      );
      return {content: [{text: err.message, type: "text"}], isError: true};
    }
  });
};
