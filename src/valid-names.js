// Jira rejects an unknown issue type or link type without naming the valid
// ones, so the caller guesses again ("QA-Subtask", "QA Subtask", ...). On that
// error, fetch the valid names and append them. Any other error, or a failed
// lookup, rethrows Jira's original message untouched.
const withValidNames = async (call, pattern, label, names) => {
  try {
    return await call();
  } catch (err) {
    if (!pattern.test(err.message)) throw err;
    const list = await names().catch(() => null);
    if (!list?.length) throw err;
    throw new Error(
      `${err.message}\nValid ${label}: ${[...new Set(list)].join(", ")}`,
    );
  }
};

// A project scopes its issue types; without one (a JQL search), list them all.
export const withIssueTypes = (call, jira, project) =>
  // JQL: "... for the field 'issuetype'" (or 'type'); create/update: {"issuetype":"..."}.
  withValidNames(
    call,
    /field '(issuetype|type)'|"issuetype"/,
    "issue types",
    async () =>
      project
        ? (await jira("GET", `/project/${project}`)).issueTypes.map(
            (t) => t.name,
          )
        : (await jira("GET", "/issuetype")).map((t) => t.name),
  );

export const withLinkTypes = (call, jira) =>
  withValidNames(call, /issue link type/i, "link types", async () =>
    (await jira("GET", "/issueLinkType")).issueLinkTypes.map((t) => t.name),
  );
