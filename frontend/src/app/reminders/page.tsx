"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPendingReminders, clearStepReminder, type PendingReminder } from "@/lib/api";

function formatRemindAt(dateStr: string): { label: string; isPast: boolean } {
  const d = new Date(dateStr);
  const now = new Date();
  const isPast = d <= now;
  const diff = Math.abs(d.getTime() - now.getTime());
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);

  let label: string;
  if (isPast) {
    if (hours < 1) label = "Due now";
    else if (hours < 24) label = `${hours}h overdue`;
    else label = `${days}d overdue`;
  } else {
    if (hours < 1) label = "Due soon";
    else if (hours < 24) label = `In ${hours}h`;
    else label = `In ${days}d`;
  }

  return {
    label: `${label} — ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}`,
    isPast,
  };
}

export default function RemindersPage() {
  const router = useRouter();
  const [reminders, setReminders] = useState<PendingReminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPendingReminders()
      .then(setReminders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleClear = async (guideId: string, stepId: string) => {
    setReminders((prev) => prev.filter((r) => !(r.guide_id === guideId && r.step_id === stepId)));
    try {
      await clearStepReminder(guideId, stepId);
    } catch {}
  };

  const handleOpen = (guideId: string) => {
    router.push(`/guides?open=${guideId}`);
  };

  // Group by guide
  const grouped = reminders.reduce<Record<string, { title: string; items: PendingReminder[] }>>((acc, r) => {
    if (!acc[r.guide_id]) acc[r.guide_id] = { title: r.guide_title, items: [] };
    acc[r.guide_id].items.push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-lg mx-auto px-4 py-6 min-h-screen">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-lg hover:bg-surface-100 text-text-500"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-semibold text-text-800">My Reminders</h1>
        <span className="text-xs text-text-400 bg-surface-100 px-2 py-0.5 rounded-full">
          {reminders.length}
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-sage/30 border-t-sage rounded-full animate-spin" />
        </div>
      ) : reminders.length === 0 ? (
        <div className="text-center py-16 text-text-400">
          <div className="text-3xl mb-3">🔔</div>
          <p className="text-sm">No reminders set yet.</p>
          <p className="text-xs mt-1">Open a playbook and tap the bell icon on any step.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([guideId, { title, items }]) => (
            <div key={guideId} className="bg-white rounded-xl border border-surface-200 overflow-hidden">
              <button
                onClick={() => handleOpen(guideId)}
                className="w-full px-4 py-2.5 text-left bg-surface-50 border-b border-surface-200 hover:bg-surface-100 transition-colors"
              >
                <span className="text-xs font-semibold text-text-700">{title}</span>
                <span className="text-[10px] text-text-400 ml-2">Open &rarr;</span>
              </button>
              <div className="divide-y divide-surface-100">
                {items.map((r) => {
                  const { label, isPast } = formatRemindAt(r.remind_at);
                  return (
                    <div key={`${r.guide_id}-${r.step_id}`} className="px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-700 font-medium truncate">{r.step_title}</p>
                        <p className={`text-[11px] mt-0.5 ${isPast ? "text-red-500 font-medium" : "text-text-400"}`}>
                          {label}
                        </p>
                        {r.note && (
                          <p className="text-[11px] text-text-400 italic mt-0.5 truncate">{r.note}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleClear(r.guide_id, r.step_id)}
                        className="flex-shrink-0 p-1.5 rounded-lg text-text-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Clear reminder"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
