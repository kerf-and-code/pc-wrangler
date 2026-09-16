import type { Metadata } from "next";

// The login page is a client component, so it cannot export metadata itself. This layout supplies
// the route's <title> without touching the page.

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
