"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "./LanguageProvider";
import {
  listConversations,
  renameConversation,
  deleteConversation,
  type Conversation,
} from "@/lib/api";

interface Props {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  refreshKey?: number;
  mobileOpen?: boolean;
  onMobileToggle?: () => void;
}

function groupByDate(convos: Conversation[], t: (key: string) => string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: { label: string; items: Conversation[] }[] = [
    { label: t("sidebar.today"), items: [] },
    { label: t("sidebar.yesterday"), items: [] },
    { label: t("sidebar.older"), items: [] },
  ];

  for (const c of convos) {
    const d = new Date(c.updated_at + "Z");
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else groups[2].items.push(c);
  }
  return groups.filter((g) => g.items.length > 0);
}

export default function ConversationSidebar({
  activeId,
  onSelect,
  onNewChat,
  refreshKey,
  mobileOpen: controlledOpen,
  onMobileToggle,
}: Props) {
  const { user, login, logout } = useAuth();
  const { t } = useLanguage();
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);

  const mobileOpen = controlledOpen ?? internalOpen;
  const closeMobile = () => {
    if (onMobileToggle) onMobileToggle();
    else setInternalOpen(false);
  };

  // Fetch conversations
  useEffect(() => {
    if (!user) return;
    listConversations()
      .then(setConvos)
      .catch(() => {});
  }, [user, refreshKey]);

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    await renameConversation(id, editTitle.trim());
    setConvos((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: editTitle.trim() } : c))
    );
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteConversation(id);
    setConvos((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) onNewChat();
  };

  const startEdit = (c: Conversation) => {
    setEditingId(c.id);
    setEditTitle(c.title);
    setTimeout(() => editRef.current?.focus(), 50);
  };

  const groups = groupByDate(convos, t);

  const sidebarContent = (
    <div className="flex flex-col h-full bg-surface-50 border-r border-surface-300">
      {/* New Chat */}
      <div className="p-3 border-b border-surface-300">
        <button
          onClick={() => {
            onNewChat();
            closeMobile();
          }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-text-700 bg-surface-200 hover:bg-surface-300 rounded-lg transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          {t("sidebar.newChat")}
        </button>
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto p-2">
        {!user ? (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-text-500 mb-4">
              {t("sidebar.signInPrompt")}
            </p>
            <button
              onClick={login}
              className="flex items-center gap-2 mx-auto px-4 py-2 text-sm font-medium bg-white border border-surface-300 rounded-lg hover:bg-surface-100 transition-colors text-text-700"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t("sidebar.signInGoogle")}
            </button>
          </div>
        ) : convos.length === 0 ? (
          <p className="text-xs text-text-400 text-center py-8">
            {t("sidebar.noConversations")}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="text-[10px] font-semibold text-text-400 uppercase tracking-wider px-2 mb-1">
                {group.label}
              </p>
              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
                    c.id === activeId
                      ? "bg-sage/15 text-sage-dark font-medium"
                      : "text-text-600 hover:bg-surface-200"
                  }`}
                  onClick={() => {
                    onSelect(c.id);
                    closeMobile();
                  }}
                >
                  {editingId === c.id ? (
                    <input
                      ref={editRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => handleRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 min-w-0 bg-white border border-surface-300 rounded px-1 py-0.5 text-xs"
                      style={{ fontSize: "16px" }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate text-xs">
                        {c.title}
                      </span>
                      {c.village && (
                        <span className="flex-shrink-0 text-[10px] text-sage bg-sage/10 px-1.5 py-0.5 rounded-full hidden group-hover:inline">
                          {c.village}
                        </span>
                      )}
                      <div className="flex-shrink-0 hidden group-hover:flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c);
                          }}
                          className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center text-text-400 hover:text-text-700"
                          title="Rename"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(c.id);
                          }}
                          className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center text-text-400 hover:text-red-500"
                          title="Delete"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* User section */}
      {user && (
        <div className="p-3 border-t border-surface-300 flex items-center gap-2">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-sage/20 flex items-center justify-center text-xs font-medium text-sage">
              {user.name?.[0] || user.email?.[0] || "?"}
            </div>
          )}
          <span className="flex-1 text-xs text-text-600 truncate">
            {user.name || user.email}
          </span>
          <button
            onClick={logout}
            className="text-xs text-text-400 hover:text-text-700"
            title={t("auth.signOut")}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-40"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar — mobile drawer or desktop fixed */}
      <aside
        className={`
          fixed md:relative z-40 h-full w-64
          transition-transform duration-200
          ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        `}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
