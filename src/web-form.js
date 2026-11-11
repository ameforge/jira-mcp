import {AUTH_HEADER, JIRA_HOST} from "./jira-client.js";

// Field errors are class="error"; the banner is class="aui-message
// aui-message-error" with its text in nested tags, so each block is read up to
// its balanced closing tag rather than to the first "<".
const ERROR_OPEN =
  /<(\w+)[^>]*\bclass="(?:[^"]*\s)?(?:aui-message-)?error(?:\s[^"]*)?"[^>]*>/gi;
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Every error a form page shows, joined with "; ", or "" when it shows none. */
export const formErrors = (html) => {
  const reasons = new Set();
  let end = 0;
  for (const open of html.matchAll(ERROR_OPEN)) {
    if (open.index < end) continue; // nested in a block already read
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

// Classic forms carry the token in a hidden input; WorklogPRO's dialog only in
// a URL (atl_token=...), kept as sent since it goes back into a URL.
const readToken = (html) =>
  html.match(/name="atl_token"\s+value="([^"]+)"/)?.[1] ??
  html.match(/atl_token=([A-Za-z0-9%_-]+)/)?.[1];

const MAX_HOPS = 10;

/**
 * @typedef {object} FormPage
 * @property {boolean} done redirected to the issue page, which is how a classic form reports success; that page is not loaded
 * @property {boolean} redirected Jira answered with at least one redirect
 * @property {boolean} ok done, or the last answer was 2xx
 * @property {number} status HTTP status of the last answer
 * @property {string} url absolute URL of the last answer, for resolving a form's relative action
 * @property {string} html "" when done
 * @property {string} errors what formErrors reads from html
 * @property {string} [token] the page's atl_token
 */

/**
 * One Jira web session for a classic /secure form flow. Its atl_token is tied
 * to the session, and Basic Auth opens a fresh session per request, so every
 * request of one flow must carry the cookies the earlier ones set; redirects
 * are followed here by hand for the same reason. A path is relative to the
 * Jira host; an absolute URL (a resolved form action) is used as is.
 * @returns {{open: (path: string) => Promise<FormPage>, submit: (path: string, fields: any) => Promise<FormPage>}}
 */
export const formSession = (host = JIRA_HOST, auth = AUTH_HEADER) => {
  const cookies = new Map();
  // A submit without fields still POSTs: body "" means POST, undefined GET.
  const send = async (url, body) => {
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
    });
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
