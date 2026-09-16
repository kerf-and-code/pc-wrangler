import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Suspense } from "react";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Your sign-in link didn&apos;t go through. It may have expired or already
        been used. Head back and request a fresh one, then open the newest email.
      </p>
      <p className="text-sm mt-4">
        <a href="/auth/login" className="underline">Return to sign in</a>
      </p>
      {params?.error ? (
        <p className="text-xs text-muted-foreground mt-4">
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
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Sorry, something went wrong.
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense>
                <ErrorContent searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
