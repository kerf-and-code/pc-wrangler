"use client";

import React from "react";
import { useRouter } from "next/navigation";
import EnterSplash from "@/components/enter-splash";

/* The pull-to-enter moment, moved here from the root.
   The root now has to be a crawlable landing page: it is the URL people link to, the one every
   published codex points back to, and a splash gives a search engine nothing to read. This keeps
   the moment intact for anyone who wants it, and the landing page sends you here. */

export default function Enter() {
  const router = useRouter();
  return <EnterSplash onEnter={() => router.push("/gm/start")} />;
}
