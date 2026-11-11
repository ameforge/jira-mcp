import assert from "node:assert/strict";
import {test} from "node:test";

// Minimal stand-in for McpServer: captures the registered handler so tests
// can invoke a tool directly without an MCP transport.
export const fakeServer = () => {
  const tools = new Map();
  return {
    registerTool: (name, _config, handler) => tools.set(name, handler),
    tools,
  };
};

// Registers a tool against a fake Jira that records every request and calls
// it once. For tools that are a single Jira request, that request is the
// whole contract.
export const callTool = async (register, name, args) => {
  const server = fakeServer();
  const requests = [];
  register(server, async (...req) => {
    requests.push(req);
    return null;
  });
  const result = await server.tools.get(name)(args);
  return {isError: result.isError, requests, text: result.content[0].text};
};

// Stand-in for formSession: answers each open/submit with the page whose key
// the URL contains (first match wins; anything else is an empty 200 page) and
// records every request, with the session it went through, in `sent`.
export const fakeForms = (pages) => {
  const sent = [];
  let sessions = 0;
  const forms = () => {
    const session = ++sessions;
    const load = (method) => async (path, fields) => {
      const url = /^https?:/.test(path) ? path : `https://jira.test${path}`;
      sent.push({
        fields: fields && new URLSearchParams(fields),
        method,
        session,
        url,
      });
      const key = Object.keys(pages).find((k) => url.includes(k));
      return {
        done: false,
        errors: "",
        html: "",
        ok: true,
        redirected: false,
        status: 200,
        url,
        ...(key && pages[key]),
      };
    };
    return {open: load("open"), submit: load("submit")};
  };
  return {forms, sent};
};

// One test per [register, toolName, args, expectedRequest] row.
export const testRequests = (cases) => {
  for (const [register, name, args, request] of cases) {
    test(`${name} sends ${request[0]} ${request[1]}`, async () => {
      const {isError, requests} = await callTool(register, name, args);
      assert.equal(isError, undefined);
      assert.deepEqual(requests, [request]);
    });
  }
};
