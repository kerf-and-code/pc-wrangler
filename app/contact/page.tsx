import type { Metadata } from "next";
import SiteShell from "@/components/site/site-shell";
import ContactForm from "@/components/contact-form";

// app/contact/page.tsx
//
// The public contact page. Server shell + the client form. Allowlisted in proxy.ts (/contact and
// /api/contact) so a logged-out visitor can reach and send it.

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the team behind Six Axes: questions, pilot access, bugs, or partnerships.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <SiteShell
      title="Contact us"
      tagline="Questions, pilot access, a bug, or a partnership. Tell us what you need and we will get back to you."
    >
      <ContactForm />
    </SiteShell>
  );
}
