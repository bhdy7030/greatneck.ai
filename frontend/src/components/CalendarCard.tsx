"use client";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

interface CalendarCardProps {
  url: string;
  title: string;
  date: string;
  time?: string;
  venue: string;
}

export default function CalendarCard({ url, title, date, time, venue }: CalendarCardProps) {
  const fullUrl = url.startsWith("/") ? `${BASE_URL}${url}` : url;
  const dateTime = [date, time].filter(Boolean).join(" · ");

  return (
    <div className="my-3 bg-surface-50 border border-surface-300 rounded-xl p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-sage/10 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-text-800 leading-snug">{title}</h4>
          {dateTime && (
            <p className="text-xs text-text-600 mt-0.5">{dateTime} ET</p>
          )}
          {venue && (
            <div className="flex items-center gap-1 mt-0.5">
              <svg className="w-3 h-3 text-text-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-xs text-text-500">{venue}</span>
            </div>
          )}
        </div>
      </div>
      <a
        href={fullUrl}
        download
        className="mt-3 flex items-center justify-center gap-2 w-full py-2 px-4 bg-sage text-white text-sm font-medium rounded-lg hover:bg-sage-dark transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Add to Calendar
      </a>
    </div>
  );
}
