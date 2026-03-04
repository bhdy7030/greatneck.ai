import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AskMura",
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("askmura_theme");if(t&&["light","dark","classic"].includes(t)){document.documentElement.setAttribute("data-theme",t)}else{document.documentElement.setAttribute("data-theme","light")}}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`,
          }}
        />
      </head>
      <body className={`${inter.className} h-full flex flex-col`}>
        <ThemeProvider>
          {/* Navigation Header */}
          <header className="flex-shrink-0 bg-surface-50 border-b border-surface-300">
            <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
              <a href="/" className="flex items-center gap-2.5">
                {/* Tree / village icon */}
                <svg
                  className="w-7 h-7 text-sage"
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
                <span className="text-lg font-bold text-text-900">
                  AskMura
                </span>
              </a>
              <nav className="flex items-center gap-4">
                <a
                  href="/chat/"
                  className="text-sm text-text-500 hover:text-text-800 transition-colors"
                >
                  Chat
                </a>
                <a
                  href="/admin/"
                  className="text-sm text-text-500 hover:text-text-800 transition-colors"
                >
                  Admin
                </a>
                <a
                  href="/debug/"
                  className="text-sm text-gold hover:text-gold-dark transition-colors"
                >
                  Debug
                </a>
                <ThemeToggle />
              </nav>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  );
}
