import type { Metadata } from "next";
import ActivityApp from "@/components/activity/activity-app";

// app/activity (2026-11-11, push 34, audit P7): Six Axes as a Discord Activity. Discord opens the
// app's root with a frame_id in the query; proxy.ts sends that here. Everything happens in the client
// component, which signs in through Discord and talks only to app/api/activity.

export const metadata: Metadata = { title: "Discord Activity", robots: { index: false, follow: false } };

export default function ActivityPage() {
  return <ActivityApp />;
}
