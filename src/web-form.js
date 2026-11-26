import {AUTH_HEADER, JIRA_HOST, onTimeout, TIMEOUT_MS} from "./jira-client.js";

// The aui-message-error banner nests its text in tags, so a block is read to its balanced closing tag.
const ERROR_OPEN =
  /<(\w+)[^>]*\bclass="(?:[^"]*\s)?(?:aui-message-)?error(?:\s[^"]*)?"[^>]*>/gi;
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const formErrors = (html) => {
  const reasons = new Set();
  let end = 0;
  for (const open of html.matchAll(ERROR_OPEN)) {
    if (open.index < end) continue;
    const start = open.index + open[0].length;
    const tag = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "gi");
    tag.lastIndex = start;
    let depth = 1;
    end = html.length;
    for (let m = tag.exec(html); m; m = tag.exec(html)) {
      depth += m[1] ? -1 : 1;
      if (!depth) {
        end = m.index;
        break;
      }
    }
    const text = textOf(html.slice(start, end)).slice(0, 300);
    if (text) reasons.add(text);
  }
  return [...reasons].join("; ");
};

// WorklogPRO's dialog has atl_token only in a URL, so it is kept encoded as sent: it goes back into one.
const readToken = (html) =>
  html.match(/name="atl_token"\s+value="([^"]+)"/)?.[1] ??
  html.match(/atl_token=([A-Za-z0-9%_-]+)/)?.[1];

const MAX_HOPS = 10;

/**
 * @typedef {object} FormPage
 * @property {boolean} done a classic form reports success by redirecting to the issue page
 * @property {boolean} redirected
 * @property {boolean} ok
 * @property {number} status
 * @property {string} url
 * @property {string} html
 * @property {string} errors
 * @property {string} [token]
 */

/**
 * atl_token is tied to a session and Basic Auth opens one per request, so cookies and redirects go by hand.
 * @returns {{open: (path: string) => Promise<FormPage>, submit: (path: string, fields: any) => Promise<FormPage>}}
 */
export const formSession = (host = JIRA_HOST, auth = AUTH_HEADER) => {
  const cookies = new Map();
  const send = async (url, body) => {
    // Credentials and cookies must never reach a redirect or form action off JIRA_HOST (an SSO page).
    const origin = new URL(url).origin;
    if (origin !== new URL(host).origin) {
      throw new Error(
        `Jira sent the form to ${origin}, which is not JIRA_HOST; nothing was sent there. Set JIRA_HOST to Jira's base URL. An earlier step of this change may already be saved.`,
      );
    }
    const post = body !== undefined;
    const res = await fetch(url, {
      body,
      headers: {
        Accept: "text/html,*/*",
        Authorization: auth,
        ...(cookies.size && {
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        }),
        ...(post && {"Content-Type": "application/x-www-form-urlencoded"}),
      },
      method: post ? "POST" : "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(onTimeout(post ? "POST" : "GET"));
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  };

  /** @returns {Promise<FormPage>} */
  const load = async (path, body) => {
    let url = /^https?:/.test(path) ? path : `${host}${path}`;
    let res = await send(url, body);
    let redirected = false;
    for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
      const location = res.headers.get("location");
      if (!location) break;
      if (hop === MAX_HOPS) {
        throw new Error(`Jira redirected more than ${MAX_HOPS} times`);
      }
      redirected = true;
      url = new URL(location, url).href;
      if (url.includes("/browse/")) {
        return {
          done: true,
          errors: "",
          html: "",
          ok: true,
          redirected,
          status: res.status,
          url,
        };
      }
      res = await send(url);
    }
    const html = await res.text();
    return {
      done: false,
      errors: formErrors(html),
      html,
      ok: res.ok,
      redirected,
      status: res.status,
      token: readToken(html),
      url,
    };
  };

  return {
    open: (path) => load(path),
    submit: (path, fields) =>
      load(path, new URLSearchParams(fields).toString()),
  };
};
