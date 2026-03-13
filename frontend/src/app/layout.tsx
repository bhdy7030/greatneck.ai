import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import AuthProvider from "@/components/AuthProvider";
import InviteGate from "@/components/InviteGate";
import HeaderAuth from "@/components/HeaderAuth";
import NavLinks from "@/components/NavLinks";
import PageTracker from "@/components/PageTracker";

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
            __html: `(function(){document.documentElement.setAttribute("data-theme","nord")})()`,
          }}
        />
      </head>
      <body className={`${inter.className} ${sourceSerif.variable} h-full flex flex-col pb-[env(safe-area-inset-bottom)]`}>
        <AuthProvider>
          <LanguageProvider>
          <ThemeProvider>
            <InviteGate>
            {/* Navigation Header */}
            <header className="flex-shrink-0 bg-surface-50 border-b border-surface-300 relative z-30">
              <div className="max-w-4xl mx-auto px-4 py-2 md:py-3 flex items-center justify-between min-h-[48px]">
                <a href="/" className="flex items-center gap-2">
                  <svg
                    className="w-6 h-6 md:w-7 md:h-7 text-sage"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
                    />
                  </svg>
                  <span className="text-base md:text-lg font-bold text-text-900">
                    greatneck.ai
                  </span>
                </a>
                <nav className="flex items-center gap-3 md:gap-4">
                  <NavLinks />
                  <LanguageToggle />
                  {/* <ThemeToggle /> */}
                  <HeaderAuth />
                </nav>
              </div>
            </header>

            <PageTracker />

            {/* Main content */}
            <main className="flex-1 flex flex-col overflow-hidden">
              {children}
            </main>
            </InviteGate>
          </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
