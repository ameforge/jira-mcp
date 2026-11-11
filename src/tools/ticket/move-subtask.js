// Jira's REST API ignores a parent change on an existing sub-task, so this
// drives the UI's Move > Change Parent form instead. Not retried: it is a POST.
/**
 * @param {typeof import("../../web-form.js").formSession} forms
 * @param {string} issueId numeric issue id (the form does not take a key)
 * @param {string} parentKey
 */
export const moveSubtaskParent = async (forms, issueId, parentKey) => {
  const session = forms();
  // The parent form redirects to a session timeout unless the Move wizard was
  // opened first in the same session, and its atl_token is tied to that session.
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
  // Success redirects to the issue; a rejected parent re-renders the form
  // with the reason in an error element.
  if (!res.redirected) {
    throw new Error(
      `Jira rejected the parent change to ${parentKey} (HTTP ${res.status})` +
        (res.errors ? `: ${res.errors}` : ""),
    );
  }
};
