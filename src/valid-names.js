// Jira rejects an unknown issue type without naming the valid ones, so the caller would keep guessing.
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
