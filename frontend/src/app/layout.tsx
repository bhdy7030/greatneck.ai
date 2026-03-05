import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import AuthProvider from "@/components/AuthProvider";
import HeaderAuth from "@/components/HeaderAuth";
import NavLinks from "@/components/NavLinks";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "greatneck.ai",
  description:
    "AI-powered community assistant for Great Neck village codes, permits, and local info",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("gn_theme");if(t&&["light","dark","classic"].includes(t)){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","light")}}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`,
          }}
        />
      </head>
      <body className={`${inter.className} h-full flex flex-col pb-[env(safe-area-inset-bottom)]`}>
        <AuthProvider>
          <LanguageProvider>
          <ThemeProvider>
            {/* Navigation Header */}
            <header className="flex-shrink-0 bg-surface-50 border-b border-surface-300">
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
                <nav className="flex items-center gap-2 md:gap-4">
                  <NavLinks />
                  <LanguageToggle />
                  <ThemeToggle />
                  <HeaderAuth />
                </nav>
              </div>
            </header>

            {/* Main content */}
            <main className="flex-1 flex flex-col overflow-hidden">
              {children}
            </main>
          </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
