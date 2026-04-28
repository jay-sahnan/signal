import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

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
        className={`${inter.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ClerkProvider appearance={{ theme: shadcn }}>
          <PostHogIdentify />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <StreamingProvider>
              <TooltipProvider>
                <DashboardShell banner={<MissingKeyBannerStack />}>
                  {children}
                </DashboardShell>
                <Toaster richColors />
              </TooltipProvider>
            </StreamingProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
