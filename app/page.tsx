"use client";

import React from "react";
import { useRouter } from "next/navigation";
import EnterSplash from "@/components/enter-splash";

/* Root: the pull-to-enter moment. Throw the breaker and drop into Start here,
   the getting-started checklist under Table. */

export default function Home() {
  const router = useRouter();
  return <EnterSplash onEnter={() => router.push("/gm/start")} />;
}
