// Ids are the wa_1 / wa_2 form option values; 8 is the Correction activity, so "fix" is in ACTIVITIES only.
export const WORK_TYPES = {
  code: 3,
  coding: 3,
  deploy: 5,
  deployment: 5,
  design: 2,
  dev: 3,
  management: 11,
  meeting: 12,
  mgmt: 11,
  misc: 14,
  operation: 6,
  ops: 6,
  other: 14,
  others: 14,
  qa: 4,
  release: 5,
  req: 1,
  requirement: 1,
  research: 13,
  test: 4,
  testing: 4,
  translation: 10,
};

export const ACTIVITIES = {
  correct: 8,
  correction: 8,
  create: 7,
  fix: 8,
  new: 7,
  review: 9,
};

// Tool descriptions ship on every LLM request, so advertise one alias per id; all aliases stay accepted.
export const canonicalNames = (map) => {
  const byId = new Map();
  for (const [name, id] of Object.entries(map)) {
    if (!byId.has(id)) byId.set(id, name);
  }
  return [...byId.values()].join(", ");
};

// The alias canonicalNames advertises, so a printed type can be fed straight back to log_work.
const nameOf = (map, id) =>
  Object.keys(map).find((k) => map[k] === Number(id)) ?? `type ${id}`;

// REST worklogs omit the types; WorklogPRO lists them as attrTypeId 1 (work) and 2 (activity), unordered.
export const worklogTypes = async (jira, worklogId) => {
  try {
    const {workLogAttributes = []} =
      (await jira(
        "GET",
        `/rest/com.deniz.jira.worklog/1.0/worklog/${worklogId}`,
      )) ?? {};
    const attr = (typeId) =>
      workLogAttributes.find((a) => a.attrTypeId === typeId)?.attrValue;
    const work = attr(1);
    const activity = attr(2);
    if (!work || !activity) return "[no type]";
    return `[${nameOf(WORK_TYPES, work)}/${nameOf(ACTIVITIES, activity)}]`;
  } catch {
    return "[type unknown]";
  }
};

// Resolved before any request, so an unknown alias fails with nothing posted.
const resolveAlias = (map, name, label) => {
  if (!name) return null;
  const id = map[name.toLowerCase()];
  if (id == null) {
    throw new Error(
      `Unknown ${label} "${name}". Valid: ${Object.keys(map).join(", ")}`,
    );
  }
  return id;
};

export const worklogDates = (iso) => {
  const date = new Date(iso);
  // WorklogPRO interprets the start time in the Jira server's timezone.
  const WORKLOG_TZ =
    process.env.JIRA_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const display = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "numeric",
      hour12: true,
      minute: "2-digit",
      month: "short",
      timeZone: WORKLOG_TZ,
      year: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const iso24 = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone: WORKLOG_TZ,
      year: "numeric",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    startDate: `${iso24.year}-${iso24.month}-${iso24.day} ${iso24.hour}:${iso24.minute}`,
    startDateJS: `${display.day}/${display.month}/${display.year} ${display.hour}:${display.minute} ${display.dayPeriod}`,
  };
};

const restLogWork = async (jira, ticketId, timeSpent, {comment, started}) => {
  const body = {timeSpent};
  if (started) body.started = started;
  if (comment) body.comment = comment;
  const worklog = await jira("POST", `/issue/${ticketId}/worklog`, body);
  return {id: worklog?.id};
};

// REST cannot set wa_1/wa_2, and a worklog logged without them has to be fixed by hand, so no REST fallback.
/**
 * @param {Function} jira
 * @param {typeof import("../../web-form.js").formSession} forms
 * @param {string} ticketId
 * @param {string} timeSpent
 * @param {{activity?: string, comment?: string, started?: string, workType?: string}} [opts]
 * @returns {Promise<{id?: string}>}
 */
export const logWorkPro = async (
  jira,
  forms,
  ticketId,
  timeSpent,
  opts = {},
) => {
  const {comment, started} = opts;
  const workType = resolveAlias(WORK_TYPES, opts.workType, "work_type");
  const activity = resolveAlias(ACTIVITIES, opts.activity, "activity");
  // The WorklogPRO form mandates Type of Activity, so a log without types must go through REST.
  if (workType == null && activity == null) {
    return restLogWork(jira, ticketId, timeSpent, {comment, started});
  }
  // The atl_token must match the session's atlassian.xsrf.token cookie, so GET and POST share a session.
  const session = forms();
  const form = await session.open(
    `/secure/WPCreateWorklogOnIssueWithWorkLogAction!default.jspa?issueKey=${encodeURIComponent(ticketId)}&decorator=dialog&inline=true`,
  );
  if (!form.ok) {
    throw new Error(
      `WorklogPRO form unavailable (HTTP ${form.status}); nothing was logged, safe to retry`,
    );
  }
  if (!form.token) throw new Error("WorklogPRO: CSRF token not found");

  // The form pre-fills the current time in the exact formats Jira expects; reuse them as defaults.
  const fieldValue = (name) =>
    form.html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ??
    "";
  const dates = started ? worklogDates(started) : null;

  const params = new URLSearchParams({
    adjustEstimate: "auto",
    issueKey: ticketId,
    remainingEstimateOptionsExpanded: "false",
    timeLogged: timeSpent,
  });
  // startDateJS wins and must be Jira's display format ("22/Jul/26 8:24 PM"); others are silently ignored.
  params.set("startDateJS", dates?.startDateJS ?? fieldValue("startDateJS"));
  params.set("startDate", dates?.startDate ?? fieldValue("startDate"));
  if (workType != null) params.set("wa_1", String(workType));
  if (activity != null) params.set("wa_2", String(activity));
  if (comment) params.set("comment", comment);

  const post = await session.submit(
    `/secure/WPCreateWorklogOnIssueWithWorkLogAction.jspa?atl_token=${form.token}`,
    params,
  );
  // No REST fallback: a failed POST may still have created the worklog, and a replay would log it twice.
  if (!post.ok) {
    throw new Error(
      `WorklogPRO: submit failed (HTTP ${post.status}); do not retry, the worklog may already exist: ask the user to check the Work Log tab of ${ticketId} in Jira`,
    );
  }
  if (post.html.includes("XSRF Security Token Missing")) {
    throw new Error("WorklogPRO: XSRF token rejected");
  }
  // Any error element (e.g. "Type of Activity is required") means the worklog was not created.
  if (post.errors || post.html.includes("aui-message-error")) {
    throw new Error(
      `WorklogPRO: ${post.errors || "the form reported an error without readable text"}; nothing was logged, fix the input and retry`,
    );
  }
  return {};
};
