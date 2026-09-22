import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Fonts are bundled locally (app/fonts + the geist package): no build-time fetch from Google Fonts, so a network hiccup or a
// Turbopack font-resolution change can never take the dashboard down.
const inter = localFont({ src: "./fonts/InterVariable.woff2", variable: "--font-inter", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "AfterCircular — Turn regulatory change into action.",
    template: "%s — AfterCircular",
  },
  description: "Continuous regulatory intelligence for evidence-grounded, human-reviewed compliance action.",
  applicationName: "AfterCircular",
  openGraph: {
    title: "AfterCircular — Turn regulatory change into action.",
    description: "Continuous regulatory intelligence for evidence-grounded, human-reviewed compliance action.",
    siteName: "AfterCircular",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ececeb",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth" className={`${inter.variable} ${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Theme class drives only the shadcn tokens used by the app under /dashboard; the landing keeps its own light palette. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="ac-theme" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
