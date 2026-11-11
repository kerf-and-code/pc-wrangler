import type { Metadata } from "next";
import LegalPage from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Add-on API",
  description: "Build on Six Axes: read chat and rolls, post to the table, follow the fight, and receive webhooks.",
  alternates: { canonical: "/developers" },
};

// app/developers/page.tsx (push 16, audit P9)
//
// The public reference for the add-on API (Phase 6b, p131): the four key-scoped endpoints in
// app/api/addon/v1 and the webhooks sent by lib/addons/deliver.ts. Written from those files; when an
// endpoint changes, change this page with it. Uses the plain document frame of the legal pages, so it
// reads without an account.

const pre: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.55,
  background: "rgba(11,7,18,0.6)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
  padding: "12px 14px", overflowX: "auto", whiteSpace: "pre", margin: "10px 0 18px",
};

export default function DevelopersPage() {
  return (
    <LegalPage>
      <h1>Add-on API</h1>
      <p className="meta">Last updated: November 10, 2026</p>

      <p>
        Six Axes has a small API for add-ons: a Discord bot that posts critical hits, a stream overlay that shows
        the turn order, a script that rolls for a familiar. An add-on works for one campaign, with a key the GM
        makes, and can only do what that key allows.
      </p>

      <h2>Keys</h2>
      <p>
        The GM makes a key on the tabletop, in the side panel&rsquo;s Add-ons tab, and picks what it may do:
      </p>
      <ul>
        <li><code>read</code>: read recent chat and rolls, and the fight.</li>
        <li><code>chat</code>: post a line to the table chat.</li>
        <li><code>roll</code>: make a roll that everyone at the table sees.</li>
      </ul>
      <p>
        The key is shown once. Send it with every call as <code>Authorization: Bearer sxa_...</code>. A key stops
        working when the GM revokes it, or when its maker is no longer the campaign&rsquo;s GM. Each key may make
        60 calls a minute; past that the API answers <code>429</code>. Errors come back as JSON,{" "}
        <code>{"{ \"error\": \"...\" }"}</code>, with <code>401</code> for a missing or unknown key and{" "}
        <code>403</code> for a key without the scope a call needs. Every endpoint allows calls from a browser (CORS).
      </p>

      <h2>Endpoints</h2>
      <p>All under <code>https://your-six-axes-address/api/addon/v1</code>.</p>

      <h3>GET /api/addon/v1</h3>
      <p>Which campaign and key this is, and what the key may do. Any valid key.</p>
      <pre style={pre}>{`{ "campaign": { "id": "...", "name": "Emberwatch" },
  "key": { "name": "Crit bot", "scopes": ["read", "chat"] } }`}</pre>

      <h3>GET /api/addon/v1/chat</h3>
      <p>
        Recent chat lines and rolls, oldest first. Scope <code>read</code>. Add <code>?since=</code> an ISO time to get
        only what came after it, and <code>&amp;secret=1</code> to include lines only the GM sees.
      </p>
      <pre style={pre}>{`{ "messages": [
  { "messageId": "...", "who": "Bobert", "kind": "roll", "text": "Attack", "secret": false,
    "addon": null, "at": "2026-11-10T19:04:12Z",
    "roll": { "label": "Greataxe", "notation": "1d20+6", "total": 23, "natural": 17, "dice": [17], "table": null } } ] }`}</pre>

      <h3>POST /api/addon/v1/chat</h3>
      <p>
        Posts a line. Scope <code>chat</code>. Body <code>{"{ \"text\": \"...\", \"kind\": \"say\" | \"emote\", \"as\": \"name\" }"}</code>;{" "}
        <code>text</code> up to 2,000 characters, <code>kind</code> and <code>as</code> optional. Answers with the posted
        message in the shape above.
      </p>

      <h3>POST /api/addon/v1/roll</h3>
      <p>
        Rolls dice for the table. Scope <code>roll</code>. Body{" "}
        <code>{"{ \"notation\": \"1d20+5\", \"label\": \"...\", \"as\": \"name\", \"secret\": false }"}</code>; only{" "}
        <code>notation</code> is required, and <code>secret</code> shows the result to the GM only.
      </p>

      <h3>GET /api/addon/v1/combat</h3>
      <p>
        The running fight: its round and the turn order, never hit points. Scope <code>read</code>. Answers{" "}
        <code>{"{ \"combat\": null }"}</code> when there is no fight.
      </p>

      <h2>Webhooks</h2>
      <p>
        Instead of asking, an add-on can be told. On the same Add-ons tab the GM adds a webhook: an https address and
        what to send to it, any of <code>roll</code>, <code>chat</code>, <code>turn</code> and <code>combat</code>. Six
        Axes POSTs JSON to the address as things happen at the table:
      </p>
      <pre style={pre}>{`{ "id": "dlv_1234", "type": "roll", "campaign": { "id": "...", "name": "Emberwatch" },
  "createdAt": "2026-11-10T19:04:12Z", "data": { ...the same fields as a chat message above } }`}</pre>
      <p>
        A <code>turn</code> delivery carries the round and whose turn it is, a <code>combat</code> delivery says a fight
        started or ended, and the &ldquo;Send a test&rdquo; button sends a <code>ping</code>. Any 2xx answer within 5
        seconds counts as delivered; anything else is retried. Redirects are not followed. A Discord channel webhook
        address gets a readable message instead of JSON.
      </p>

      <h3>Checking the signature</h3>
      <p>
        Each delivery has the headers <code>X-SixAxes-Event</code>, <code>X-SixAxes-Delivery</code> and{" "}
        <code>X-SixAxes-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>. The signature is an HMAC-SHA256 of{" "}
        <code>&lt;t&gt;.&lt;raw body&gt;</code> with the webhook&rsquo;s secret (shown when the webhook is made). Check it,
        and that <code>t</code> is within five minutes, before trusting a delivery:
      </p>
      <pre style={pre}>{`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, header, rawBody) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const want = createHmac("sha256", secret).update(t + "." + rawBody).digest();
  const got = Buffer.from(parts.v1 ?? "", "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}`}</pre>

      <h2>Example: a stream overlay</h2>
      <p>Show the last roll on screen, asking every few seconds with a <code>read</code> key:</p>
      <pre style={pre}>{`const KEY = "sxa_...";
let since = new Date().toISOString();
setInterval(async () => {
  const r = await fetch("/api/addon/v1/chat?since=" + encodeURIComponent(since),
    { headers: { Authorization: "Bearer " + KEY } }).then((x) => x.json());
  for (const m of r.messages ?? []) {
    since = m.at;
    if (m.kind === "roll") document.querySelector("#last").textContent = m.who + ": " + m.roll.total;
  }
}, 4000);`}</pre>

      <h2>Questions</h2>
      <p>
        Write to <a href="mailto:kncadmin@kerfandcode.com">kncadmin@kerfandcode.com</a>. Please do not put a key in an
        email or a public repository; revoke it and make a new one if one leaks.
      </p>
    </LegalPage>
  );
}
