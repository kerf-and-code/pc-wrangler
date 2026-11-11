import type { Metadata } from "next";

// app/admin/layout.tsx (push 17): keeps the owner console out of search engines.
export const metadata: Metadata = {
  title: "Owner console",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
