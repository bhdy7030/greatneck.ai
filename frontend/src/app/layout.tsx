import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
// ThemeToggle is now inline in HeaderAuth dropdown
import LanguageToggle from "@/components/LanguageToggle";
import AuthProvider from "@/components/AuthProvider";
import InviteGate from "@/components/InviteGate";
import HeaderAuth from "@/components/HeaderAuth";
import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import PageTracker from "@/components/PageTracker";
import ToastProvider from "@/components/ToastProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import NativeInit from "@/components/NativeInit";

const inter = Inter({ subsets: ["latin"] });
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "greatneck.ai — AI Community Assistant for Great Neck, NY",
    template: "%s | greatneck.ai",
  },
  description:
    "Ask questions about village codes, permits, events, and local info in Great Neck, NY. AI-powered community assistant.",
  metadataBase: new URL("https://greatneck.ai"),
  openGraph: {
    title: "greatneck.ai — AI Community Assistant for Great Neck, NY",
    description:
      "Ask questions about village codes, permits, events, and local info in Great Neck, NY.",
    url: "https://greatneck.ai",
    siteName: "greatneck.ai",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: "greatneck.ai",
    description: "AI-powered community assistant for Great Neck, NY",
  },
  alternates: {
    canonical: "https://greatneck.ai",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "greatneck.ai",
              url: "https://greatneck.ai",
              description: "AI-powered community assistant for Great Neck, NY",
              potentialAction: {
                "@type": "SearchAction",
                target: "https://greatneck.ai/chat/?q={search_term_string}",
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("gn_theme")||"nord";document.documentElement.setAttribute("data-theme",t)})()`,
          }}
        />
      </head>
      <body className={`${inter.className} ${sourceSerif.variable} h-full flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]`}>
        <AuthProvider>
          <ToastProvider>
          <LanguageProvider>
          <ThemeProvider>
            {/* <InviteGate> */}
            {/* Navigation Header */}
            <header className="flex-shrink-0 bg-surface-100/80 backdrop-blur-xl border-b border-surface-200/60 relative z-30">
              <div className="max-w-5xl mx-auto px-4 md:px-6 py-2.5 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 group">
                  <div className="w-7 h-7 rounded-lg bg-sage/10 flex items-center justify-center transition-colors group-hover:bg-sage/16">
                    <svg className="w-4 h-4 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01" />
                    </svg>
                  </div>
                  <span className="text-[15px] font-semibold text-text-800 tracking-tight">greatneck.ai</span>
                </Link>
                <nav className="flex items-center gap-1">
                  <NavLinks />
                  <LanguageToggle />
                  <HeaderAuth />
                </nav>
              </div>
            </header>

            <PageTracker />
            <NativeInit />

            {/* Main content */}
            <main className="flex-1 flex flex-col overflow-hidden">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>
            {/* </InviteGate> */}
          </ThemeProvider>
          </LanguageProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
