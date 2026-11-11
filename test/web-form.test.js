import assert from "node:assert/strict";
import {test} from "node:test";
import {formSession} from "../src/web-form.js";

const HOST = "https://jira.test";

// Answers each fetch with the reply whose key the URL contains and records
// every request with the headers it carried.
const stubFetch = (replies) => {
  const sent = [];
  globalThis.fetch = async (url, init = {}) => {
    sent.push({
      body: init.body,
      headers: init.headers,
      method: init.method,
      url,
    });
    const key = Object.keys(replies).find((k) => url.includes(k));
    const {body = "", cookie, location, status = 200} = replies[key] ?? {};
    return {
      headers: {
        get: (name) => (name === "location" ? (location ?? null) : null),
        getSetCookie: () => (cookie ? [`${cookie}; Path=/`] : []),
      },
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
  return sent;
};

test("a form session sends the cookies Jira set earlier with every later request", async () => {
  const sent = stubFetch({"/secure/A.jspa": {cookie: "JSESSIONID=s1"}});
  const session = formSession(HOST, "Basic abc");
  await session.open("/secure/A.jspa");
  await session.submit("/secure/B.jspa", {id: "1001", note: "a&b"});

  assert.equal(sent[0].url, `${HOST}/secure/A.jspa`);
  assert.equal(sent[0].method, "GET");
  assert.equal(sent[0].headers.Cookie, undefined);
  const post = sent[1];
  assert.equal(post.url, `${HOST}/secure/B.jspa`);
  assert.equal(post.method, "POST");
  assert.equal(post.body, "id=1001&note=a%26b");
  assert.equal(post.headers.Cookie, "JSESSIONID=s1");
  assert.equal(post.headers.Authorization, "Basic abc");
  assert.equal(
    post.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
});

test("a form session follows redirects in the session and stops at the issue page", async () => {
  const sent = stubFetch({
    "/secure/Finish.jspa": {
      cookie: "JSESSIONID=s2",
      location: "/secure/Next.jspa",
      status: 302,
    },
    "/secure/Next.jspa": {location: `${HOST}/browse/PROJ-1`, status: 302},
  });
  const page = await formSession(HOST, "Basic abc").submit(
    "/secure/Finish.jspa",
    {},
  );

  assert.deepEqual(
    sent.map((s) => [s.method, s.url, s.headers.Cookie]),
    [
      ["POST", `${HOST}/secure/Finish.jspa`, undefined],
      // The hop keeps the cookie the redirect itself set, and is a GET.
      ["GET", `${HOST}/secure/Next.jspa`, "JSESSIONID=s2"],
    ],
  );
  assert.equal(page.done, true);
  assert.equal(page.redirected, true);
  assert.equal(page.ok, true);
});

test("a form session reports a redirect that lands on another page", async () => {
  stubFetch({
    "/secure/Form.jspa": {body: "<form></form>"},
    "/secure/Start.jspa": {location: "/secure/Form.jspa", status: 302},
  });
  const page = await formSession(HOST, "x").open("/secure/Start.jspa");

  assert.equal(page.done, false);
  assert.equal(page.redirected, true);
  assert.equal(page.url, `${HOST}/secure/Form.jspa`);
  assert.equal(page.html, "<form></form>");
});

for (const [where, body, token] of [
  [
    "a hidden input",
    '<input type="hidden" id="atl_token" name="atl_token"\n  value="TOK1" />',
    "TOK1",
  ],
  ["a URL", '<form action="x?atl_token=B%2D7_c&y=1">', "B%2D7_c"],
  ["nowhere", "<form></form>", undefined],
]) {
  test(`a form page reads atl_token from ${where}`, async () => {
    stubFetch({"/secure/F.jspa": {body}});
    const page = await formSession(HOST, "x").open("/secure/F.jspa");
    assert.equal(page.token, token);
  });
}

// Jira answers a rejected form with HTTP 200 and the reasons in the page.
for (const {body, reasons} of [
  {
    // Markup from a real rejected WorklogPRO submit: one error div per field.
    body:
      '<div class="error">You must indicate the time spent working.</div>' +
      '<label for="comment">Work Description</label><div class="error">Comment is required</div>',
    reasons: "You must indicate the time spent working.; Comment is required",
  },
  {
    // Banner with the reason nested below it, as seen when wa_1 was invalid.
    body:
      '<div class="aui-message aui-message-error"><span class="aui-icon icon-error"></span>' +
      "<ul><li>Comment is required</li></ul></div>",
    reasons: "Comment is required",
  },
]) {
  test(`a form page reads its errors: ${reasons}`, async () => {
    stubFetch({"/secure/F.jspa": {body}});
    const page = await formSession(HOST, "x").submit("/secure/F.jspa", {});
    assert.equal(page.errors, reasons);
  });
}
