import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardShell } from "@/components/dashboard-shell";
import { StreamingProvider } from "@/lib/streaming-context";
import { PostHogClientProvider } from "@/components/posthog-provider";
import { PostHogPageView } from "@/components/posthog-pageview";
import { PostHogIdentify } from "@/components/posthog-identify";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Rulebase Signal Engine",
  description: "AI-powered targeting for QA, Complaints, and Sales Compliance",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <PostHogClientProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          <PostHogIdentify />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <StreamingProvider>
              <TooltipProvider>
                <DashboardShell>{children}</DashboardShell>
                <Toaster richColors />
              </TooltipProvider>
            </StreamingProvider>
          </ThemeProvider>
        </PostHogClientProvider>
      </body>
    </html>
  );
}
