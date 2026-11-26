// REST ignores a parent change on an existing sub-task, so use the Move form; a POST, so never retried.
/**
 * @param {typeof import("../../web-form.js").formSession} forms
 * @param {string} issueId numeric id, the form does not take a key
 * @param {string} parentKey
 */
export const moveSubtaskParent = async (forms, issueId, parentKey) => {
  const session = forms();
  // Change Parent redirects to a session timeout unless the Move wizard was opened first in this session.
  await session.open(
    `/secure/MoveSubTaskChooseOperation!default.jspa?id=${issueId}`,
  );
  const form = await session.open(
    `/secure/MoveSubTaskParent!default.jspa?id=${issueId}`,
  );
  if (!form.token) {
    throw new Error(
      `Change Parent form unavailable (HTTP ${form.status}); nothing was changed`,
    );
  }

  const res = await session.submit("/secure/MoveSubTaskParent.jspa", {
    atl_token: form.token,
    "Change Parent": "Change Parent",
    id: String(issueId),
    parentIssue: parentKey,
  });
  // Jira redirects to the issue on success and re-renders the form with an error on rejection.
  if (!res.redirected) {
    throw new Error(
      `Jira rejected the parent change to ${parentKey} (HTTP ${res.status})` +
        (res.errors ? `: ${res.errors}` : ""),
    );
  }
};
