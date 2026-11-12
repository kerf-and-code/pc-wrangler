import { NextResponse } from "next/server";
import { allowPublic } from "@/lib/rate-limit";

// app/api/contact/route.ts
//
// The public contact endpoint. No auth (allowlisted in proxy.ts): it only emails the admin, exactly
// like /api/pilot-request. A honeypot field and length caps keep the obvious spam out. Sends over
// Resend via fetch, from the verified send.kerfandcode.com domain, with reply_to set to the sender so
// a reply goes straight back to them.

type Body = {
  name?: string;
  email?: string;
  topic?: string;
  message?: string;
  company?: string; // honeypot
};

const CAP = { name: 120, email: 200, topic: 60, message: 4000 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;

    // Honeypot: a real person never fills this. Pretend success so a bot learns nothing.
    if (body.company && body.company.trim()) return NextResponse.json({ ok: true });

    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim();
    const topic = (body.topic ?? "General").trim();
    const message = (body.message ?? "").trim();

    if (!name || !email || !message) {
      return NextResponse.json({ error: "Name, email and a message are required." }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "That email address does not look right." }, { status: 400 });
    }
    if (name.length > CAP.name || email.length > CAP.email || topic.length > CAP.topic || message.length > CAP.message) {
      return NextResponse.json({ error: "That message is longer than we can accept." }, { status: 400 });
    }

    // Push 42 (audit round 2, T22): a few messages per address an hour and a ceiling per day, so a
    // script cannot use up the email quota that recaps and reminders to players depend on.
    if (!(await allowPublic("contact", request, { max: 5, windowSeconds: 3600 }, { max: 60, windowSeconds: 86400 }))) {
      return NextResponse.json({ error: "Too many messages from here for now. Please try again later, or email kncadmin@kerfandcode.com." }, { status: 429 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Contact isn't available right now. Please email kncadmin@kerfandcode.com." }, { status: 503 });
    }

    const text =
      `New contact message from the Six Axes site.\n\n` +
      `Name:  ${name}\n` +
      `Email: ${email}\n` +
      `Topic: ${topic}\n\n` +
      `${message}\n`;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Six Axes <contact@send.kerfandcode.com>",
        to: ["kncadmin@kerfandcode.com"],
        reply_to: email,
        subject: `Six Axes contact (${topic}) from ${name}`,
        text,
      }),
    });

    if (!resp.ok) {
      return NextResponse.json({ error: "Could not send just now. Please email kncadmin@kerfandcode.com directly." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Something went wrong. Please email kncadmin@kerfandcode.com directly." }, { status: 500 });
  }
}
