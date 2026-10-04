import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardShell } from "@/components/dashboard-shell";
import { MissingKeyBannerStack } from "@/components/missing-key-banner-stack";
import { PostHogIdentify } from "@/components/posthog-identify";
import { StreamingProvider } from "@/lib/streaming-context";
import { WorkspaceBootstrap } from "@/components/workspace-bootstrap";
import "./globals.css";

export const metadata: Metadata = {
  title: "Signal",
  description: "Signal Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ClerkProvider appearance={{ theme: shadcn }}>
          <PostHogIdentify />
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            storageKey="signal-theme"
            disableTransitionOnChange
          >
            <WorkspaceBootstrap>
              <StreamingProvider>
                <TooltipProvider>
                  <DashboardShell banner={<MissingKeyBannerStack />}>
                    {children}
                  </DashboardShell>
                  <Toaster richColors />
                </TooltipProvider>
              </StreamingProvider>
            </WorkspaceBootstrap>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
