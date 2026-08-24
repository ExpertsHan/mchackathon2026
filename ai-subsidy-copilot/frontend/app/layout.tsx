import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/contexts/session-context";

export const metadata: Metadata = {
  title: {
    default: "AI Subsidy Copilot",
    template: "%s · AI Subsidy Copilot",
  },
  description: "Apply smarter. Learn safer. Track every dollar.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
