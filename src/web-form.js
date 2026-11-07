import {AUTH_HEADER} from "./jira-client.js";

// Jira's classic /secure forms tie the atl_token to the session, and Basic
// Auth opens a fresh session per request, so every request of one form flow
// must carry the cookies the earlier ones set. A body makes it a form POST.
// Redirects are not followed by default: a hop's Set-Cookie would be lost.
export const formSession = () => {
  const cookies = new Map();
  /**
   * @param {string} url
   * @param {string} [body] urlencoded form fields
   * @param {RequestInit} [options] e.g. {redirect: "follow"}; headers are added
   */
  return async (url, body, {headers, ...init} = {}) => {
    const res = await fetch(url, {
      body,
      method: body ? "POST" : "GET",
      redirect: "manual",
      ...init,
      headers: {
        Authorization: AUTH_HEADER,
        ...(cookies.size && {
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        }),
        ...(body && {"Content-Type": "application/x-www-form-urlencoded"}),
        ...headers,
      },
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return res;
  };
};

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
