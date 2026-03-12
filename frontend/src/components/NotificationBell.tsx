"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  getNotifications,
  getUnreadCount,
  markNotificationsRead,
  type Notification,
} from "@/lib/api";

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Poll unread count every 60s
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const { unread: count } = await getUnreadCount();
        if (!cancelled) setUnread(count);
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications: notifs, unread_count } = await getNotifications();
      setNotifications(notifs);
      setUnread(unread_count);
    } catch {}
    setLoading(false);
  }, []);

  const handleOpen = () => {
    setOpen((v) => {
      if (!v) loadNotifications();
      return !v;
    });
  };

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead();
      setUnread(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {}
  };

  const handleNotificationClick = (n: Notification) => {
    // Mark this notification as read
    if (!n.is_read) {
      markNotificationsRead([n.id]).catch(() => {});
      setNotifications((prev) =>
        prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item))
      );
      setUnread((prev) => Math.max(prev - 1, 0));
    }

    // Navigate to the target
    if (n.target_type === "guide" && n.target_id) {
      window.location.href = `/guides?open=${n.target_id}`;
    }
    setOpen(false);
  };

  if (!user) return null;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded-full hover:bg-surface-100 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
        title="Notifications"
      >
        <svg className="w-5 h-5 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-lg shadow-lg border border-surface-200 z-50 max-h-[400px] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-surface-100">
            <span className="text-sm font-semibold text-text-800">Notifications</span>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-sage hover:text-sage/80 font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="border-b border-surface-100">
            <a
              href="/reminders/"
              className="flex items-center gap-2 px-3 py-2 text-xs text-sage hover:bg-sage/5 transition-colors"
              onClick={() => setOpen(false)}
            >
              <span>🔔</span>
              <span className="font-medium">View all reminders</span>
              <svg className="w-3 h-3 ml-auto text-text-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </a>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-sage/30 border-t-sage rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 text-center text-sm text-text-400">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-surface-50 transition-colors ${
                    !n.is_read ? "bg-sage/5" : ""
                  }`}
                >
                  {n.actor?.avatar_url ? (
                    <img
                      src={n.actor.avatar_url}
                      alt=""
                      className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-medium text-sage">
                      {n.actor?.name?.[0] || "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-700 line-clamp-2">{n.body}</p>
                    <p className="text-xs text-text-400 mt-0.5">{timeAgo(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-sage flex-shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
