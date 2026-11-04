import {AUTH_HEADER, JIRA_HOST} from "../../jira-client.js";

const MAX_STEPS = 8;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&gt;/g, ">");

// Reads the wizard's form: every field with the value the page pre-fills, the
// select options (value and visible text), and the submit button.
const parseForm = (html) => {
  const form = html.match(/<form\b[^>]*name="jiraform"[\s\S]*?<\/form>/)?.[0];
  if (!form) return null;
  const fields = new Map();
  const selects = new Map();
  for (const [tag] of form.matchAll(/<input\b[^>]*>/g)) {
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const type = tag.match(/type="(\w+)"/)?.[1] ?? "text";
    if (!name || type === "submit" || type === "button") continue;
    const checked = /\bchecked\b/.test(tag);
    // An unchecked radio group still names a field the answers can fill.
    if (type === "radio" && !checked) {
      if (!fields.has(name)) fields.set(name, "");
      continue;
    }
    if (type === "checkbox" && !checked) continue;
    fields.set(name, decode(tag.match(/value="([^"]*)"/)?.[1] ?? ""));
  }
  for (const [, name, body] of form.matchAll(
    /<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g,
  )) {
    const options = [
      ...body.matchAll(/<option([^>]*)value="([^"]*)"[^>]*>\s*([^<]*?)\s*</g),
    ].map(([, attrs, value, text]) => ({
      selected: /\bselected\b/.test(attrs),
      text: decode(text),
      value,
    }));
    selects.set(name, options);
    fields.set(name, options.find((o) => o.selected)?.value ?? "");
  }
  const submit = form.match(/<input\b[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  return {
    action: decode(form.match(/action="([^"]+)"/)[1]),
    fields,
    selects,
    submit: [
      decode(submit.match(/name="([^"]+)"/)?.[1] ?? ""),
      decode(submit.match(/value="([^"]+)"/)?.[1] ?? ""),
    ],
    text: form
      .replace(/<script[\s\S]*?<\/script>|<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " "),
  };
};

const pageErrors = (html) =>
  [...html.matchAll(/class="error[^"]*"[^>]*>\s*([^<]+?)\s*</g)].map(
    (m) => m[1],
  );

// Drives one of Jira's classic convert/move wizards to the end. `answers` sets
// fields by name wherever a step has them; everything else keeps the value the
// page pre-filled, as the UI would submit it.
const runWizard = async (startPath, answers, currentStatus, ticketId) => {
  const cookies = new Map();
  const send = async (url, body) => {
    const res = await fetch(url, {
      body,
      headers: {
        Authorization: AUTH_HEADER,
        Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(body && {"Content-Type": "application/x-www-form-urlencoded"}),
      },
      method: body ? "POST" : "GET",
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  };
  // Follows redirects by hand so every hop keeps the session cookies; a hop to
  // the issue page is how Jira reports a finished wizard.
  const load = async (url, body) => {
    let res = await send(url, body);
    while (res.status === 302) {
      url = new URL(res.headers.get("location"), url).href;
      if (url.includes("/browse/")) return {done: true};
      res = await send(url);
    }
    return {html: await res.text(), status: res.status, url};
  };

  let page = await load(`${JIRA_HOST}/secure/${startPath}`);
  for (let step = 0; step < MAX_STEPS && !page.done; step++) {
    const form = parseForm(page.html);
    if (!form) {
      const why = pageErrors(page.html).join("; ");
      throw new Error(
        `Jira did not open the issue type wizard for ${ticketId} (HTTP ${page.status})` +
          (why ? `: ${why}` : "") +
          "; nothing was changed",
      );
    }
    for (const [name, value] of Object.entries(answers)) {
      if (form.fields.has(name)) form.fields.set(name, value);
    }
    // Jira shows a status select (targetStatusId, beanTargetStatusId) only when
    // the new workflow lacks the ticket's status; picking one is the user's call.
    const status = [...form.selects].find(([name]) => /status/i.test(name));
    if (status) {
      throw new Error(
        `The new issue type's workflow has no "${currentStatus}" status for ${ticketId}; ` +
          `change it in the Jira UI and pick one of: ${status[1].map((o) => o.text).join(", ")}. Nothing was changed.`,
      );
    }
    const [submitName, submitValue] = form.submit;
    const finishing = /^(finish|move)$/i.test(submitValue);
    // The confirm page lists field values the new type cannot hold; Jira
    // deletes them on Finish, so never submit past that.
    if (finishing && /Removed fields/i.test(form.text)) {
      const removed = form.text.match(/Removed fields(.*?)(Cancel|$)/i)?.[1];
      throw new Error(
        `Changing the issue type of ${ticketId} would delete field values (${removed?.trim()}). ` +
          "Nothing was changed; do it in the Jira UI if losing them is intended.",
      );
    }
    const body = new URLSearchParams([...form.fields]);
    if (submitName) body.set(submitName, submitValue);
    const next = await load(
      new URL(form.action, page.url).href,
      body.toString(),
    );
    // A step that renders itself again with errors (e.g. a required field the
    // new type needs) did not advance.
    if (!next.done && parseForm(next.html)?.action === form.action) {
      throw new Error(
        `Jira stopped the issue type change of ${ticketId}: ${pageErrors(next.html).join("; ") || "the step did not advance"}. Nothing was changed.`,
      );
    }
    page = next;
  }
  if (!page.done) {
    throw new Error(
      `The issue type wizard for ${ticketId} did not finish within ${MAX_STEPS} steps`,
    );
  }
};

// Picks the Jira wizard for a type change to or from a sub-task type, which
// the REST edit rejects or ignores. Returns null when REST can make it.
/**
 * @param {Function} jira jiraRequest
 * @param {string} ticketId
 * @param {string} typeName target issue type name
 * @param {string} [parentKey] required when the target is a sub-task type
 */
export const planTypeChange = async (jira, ticketId, typeName, parentKey) => {
  const issue = await jira(
    "GET",
    `/issue/${ticketId}?fields=issuetype,status,project`,
  );
  const {issuetype, project, status} = issue.fields;
  const {issueTypes} = await jira("GET", `/project/${project.key}`);
  const target = issueTypes.find(
    (t) => t.name.toLowerCase() === typeName.toLowerCase(),
  );
  // An unknown name goes to REST, whose rejection lists the valid types.
  if (
    !target ||
    issuetype.id === target.id ||
    !(issuetype.subtask || target.subtask)
  ) {
    return null;
  }
  let start;
  const answers = {issuetype: target.id};
  if (issuetype.subtask && target.subtask) {
    start = `MoveSubTaskChooseOperation!default.jspa?id=${issue.id}`;
    answers.operation = "move.subtask.type.operation.name";
  } else if (issuetype.subtask) {
    start = `ConvertSubTask.jspa?id=${issue.id}`;
  } else {
    if (!parentKey) {
      throw new Error(
        `Converting ${ticketId} to "${target.name}" needs parent_key: a sub-task must have a parent`,
      );
    }
    start = `ConvertIssue.jspa?id=${issue.id}`;
    answers.parentIssueKey = parentKey;
  }
  return {answers, start, status: status.name, ticketId};
};

/** @param {NonNullable<Awaited<ReturnType<typeof planTypeChange>>>} plan */
export const runTypeWizard = ({answers, start, status, ticketId}) =>
  runWizard(start, answers, status, ticketId);
