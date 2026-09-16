import type { Metadata } from "next";
import { Suspense } from "react";
import AuthShell, { authText, authLink } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "Sign-in problem",
};

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <p style={{ ...authText, textAlign: "center", margin: "0 0 16px" }}>
        Your sign-in link didn&apos;t go through. It may have expired or already
        been used. Head back and request a fresh one, then open the newest email.
      </p>
      <p style={{ textAlign: "center", margin: 0 }}>
        <a href="/auth/login" style={authLink}>Return to sign in</a>
      </p>
      {params?.error ? (
        <p style={{ ...authText, textAlign: "center", fontSize: 12, marginTop: 16 }}>
          Details: {params.error}
        </p>
      ) : null}
    </>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <AuthShell title="Sorry, something went wrong">
      <Suspense>
        <ErrorContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
