import type { MetadataRoute } from "next";

// app/manifest.ts (push 16, audits F14 and P4)
//
// Makes Six Axes installable ("Add to Home Screen" on a phone, "Install" in a desktop browser), so the
// play sheet and the in-person recorder open full screen from an icon like an app. Next serves this at
// /manifest.webmanifest and links it from every page. No service worker: the app needs the network
// anyway, and an offline cache of signed-in pages is a risk with nothing to gain yet.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Six Axes",
    short_name: "Six Axes",
    description: "Run the table: recording, recaps, the shared tabletop and character sheets for tabletop RPGs.",
    start_url: "/me/campaigns",
    scope: "/",
    display: "standalone",
    background_color: "#14110d",
    theme_color: "#14110d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Character sheet", url: "/me/sheet" },
      { name: "Your campaigns", url: "/me/campaigns" },
      { name: "Record in person", url: "/gm/record" },
    ],
  };
}
