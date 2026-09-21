import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth" className={`${inter.variable} ${geist.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Theme class drives only the shadcn tokens used by the app under /dashboard; the landing keeps its own light palette. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="ac-theme" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
