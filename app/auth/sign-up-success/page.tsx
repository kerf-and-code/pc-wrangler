import type { Metadata } from "next";
import AuthShell, { authText } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Check your email",
};

export default function Page() {
  return (
    <AuthShell title="Thanks for signing up" subtitle="Check your email to confirm">
      <p style={{ ...authText, textAlign: "center", margin: 0 }}>
        You&apos;ve successfully signed up. Check your email to confirm your
        account before signing in.
      </p>
    </AuthShell>
  );
}
