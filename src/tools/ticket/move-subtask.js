import {AUTH_HEADER, JIRA_HOST} from "../../jira-client.js";

// Jira's REST API ignores a parent change on an existing sub-task, so this
// drives the UI's Move > Change Parent form instead. Not retried: it is a POST.
/**
 * @param {string} issueId numeric issue id (the form does not take a key)
 * @param {string} parentKey
 */
export const moveSubtaskParent = async (issueId, parentKey) => {
  const page = (path, cookie) =>
    fetch(`${JIRA_HOST}/secure/${path}?id=${issueId}`, {
      headers: {Authorization: AUTH_HEADER, ...(cookie && {Cookie: cookie})},
      redirect: "manual",
    });
  // The parent form redirects to a session timeout unless the Move wizard was
  // opened first in the same session, and its atl_token is tied to that session.
  const start = await page("MoveSubTaskChooseOperation!default.jspa");
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const form = await page("MoveSubTaskParent!default.jspa", cookie);
  const token = (await form.text()).match(
    /name="atl_token"\s+value="([^"]+)"/,
  )?.[1];
  if (!token) {
    throw new Error(
      `Change Parent form unavailable (HTTP ${form.status}); nothing was changed`,
    );
  }

  const res = await fetch(`${JIRA_HOST}/secure/MoveSubTaskParent.jspa`, {
    body: new URLSearchParams({
      atl_token: token,
      "Change Parent": "Change Parent",
      id: String(issueId),
      parentIssue: parentKey,
    }).toString(),
    headers: {
      Authorization: AUTH_HEADER,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    method: "POST",
    redirect: "manual",
  });
  // Success redirects to the issue; a rejected parent re-renders the form
  // with the reason in an error element.
  if (res.status !== 302) {
    const reason = (await res.text())
      .match(/class="error[^"]*"[^>]*>([^<]+)</)?.[1]
      ?.trim();
    throw new Error(
      `Jira rejected the parent change to ${parentKey} (HTTP ${res.status})` +
        (reason ? `: ${reason}` : ""),
    );
  }
};
