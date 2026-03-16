"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import {
  getGuides,
  getWalletGuides,
  saveGuide,
  unsaveGuide,
  forkGuide,
  getUserGuide,
  saveUserGuide,
  deleteUserGuide,
  publishUserGuide,
  updatePublishedCopy,
  getLikeStatus,
  toggleLike,
  type Guide,
  type RawGuideData,
} from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ToastProvider";
import ExploreCard from "@/components/ExploreCard";
import ExpandedGuideView from "@/components/ExpandedGuideView";
import PeekGuideView from "@/components/PeekGuideView";

export default function GuidesPage() {
  return (
    <Suspense>
      <GuidesPageInner />
    </Suspense>
  );
}

function GuidesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [tab, setTab] = useState<"wallet" | "browse">(() =>
    searchParams.get("tab") === "wallet" ? "wallet" : "browse"
  );
  const [walletGuides, setWalletGuides] = useState<Guide[]>([]);
  const [allGuides, setAllGuides] = useState<Guide[]>([]);
  const [expandedGuide, setExpandedGuide] = useState<Guide | null>(null);
  const [returnStepId, setReturnStepId] = useState<string | null>(null);
  const [peekGuide, setPeekGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingGuide, setEditingGuide] = useState<RawGuideData | null>(null);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [editSaved, setEditSaved] = useState(false);
  const [openedViaDeepLink, setOpenedViaDeepLink] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [likeStatus, setLikeStatus] = useState<Record<string, { liked: boolean; count: number }>>({});

  const village = typeof window !== "undefined" ? localStorage.getItem("gn_village") || "" : "";

  const fetchData = useCallback(async () => {
    try {
      const [wallet, all] = await Promise.all([
        getWalletGuides(village, language),
        getGuides(village, language),
      ]);
      setWalletGuides(wallet);
      setAllGuides(all);

      // Fetch like status for all guides in bulk
      const guideIds = Array.from(new Set([...wallet, ...all].map((g) => g.id)));
      if (guideIds.length > 0) {
        try {
          const statuses = await getLikeStatus("guide", guideIds);
          setLikeStatus(statuses);
        } catch {}
      }

      // Handle ?id=guideId for shareable links, or ?open=guideId from notifications
      const shareId = searchParams.get("id");
      const openId = searchParams.get("open");
      const targetId = shareId || openId;
      const urlTab = searchParams.get("tab");
      if (targetId) {
        const walletGuide = wallet.find((g) => g.id === targetId);
        const guide = walletGuide || all.find((g) => g.id === targetId);
        if (guide) {
          // Restore tab from URL, or infer from guide location
          if (urlTab === "wallet" || urlTab === "browse") {
            setTab(urlTab);
          } else if (walletGuide) {
            setTab("wallet");
          }

          if (openId) {
            // Opened via deep link (landing page / notification) -> expanded mode
            setExpandedGuide(guide);
            setOpenedViaDeepLink(true);
            // Clean up ?open= but keep ?id= style URL
            window.history.replaceState({}, "", `/guides?id=${guide.id}&tab=${urlTab || (walletGuide ? "wallet" : "browse")}`);
          } else if (walletGuide && urlTab === "wallet") {
            // Wallet guide opened from wallet tab -> expanded mode
            setExpandedGuide(guide);
          } else {
            // Shared/browse link -> peek (read-only preview) mode
            setPeekGuide(guide);
          }
        } else {
          // Guide not found -- clean up URL
          window.history.replaceState({}, "", `/guides${urlTab ? `?tab=${urlTab}` : ""}`);
        }
      } else if (urlTab === "wallet" || urlTab === "browse") {
        setTab(urlTab);
      }

      // Auto-expand to guide+step if returning from chat
      const returnJson = localStorage.getItem("gn_return_guide");
      if (returnJson) {
        localStorage.removeItem("gn_return_guide");
        try {
          const { guideId, stepId } = JSON.parse(returnJson);
          const guide = wallet.find((g) => g.id === guideId) || all.find((g) => g.id === guideId);
          if (guide) {
            setExpandedGuide(guide);
            setTab("wallet");
            if (stepId) setReturnStepId(stepId);
          }
        } catch {
          // ignore bad JSON
        }
      }
    } catch (e) {
      console.error("Failed to load guides:", e);
    } finally {
      setLoading(false);
    }
  }, [village, language, searchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle browser back/forward button
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      const urlTab = params.get("tab");

      if (!id) {
        // No guide in URL -- close any open guide
        setExpandedGuide(null);
        setPeekGuide(null);
        if (urlTab === "wallet" || urlTab === "browse") setTab(urlTab);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleSave = async (guideId: string) => {
    // Optimistic
    setAllGuides((prev) =>
      prev.map((g) => (g.id === guideId ? { ...g, saved: true } : g))
    );
    setPeekGuide((prev) =>
      prev?.id === guideId ? { ...prev, saved: true } : prev
    );
    try {
      await saveGuide(guideId);
    } catch {
      showToast("Couldn't save, try again");
      setAllGuides((prev) =>
        prev.map((g) => (g.id === guideId ? { ...g, saved: false } : g))
      );
      setPeekGuide((prev) =>
        prev?.id === guideId ? { ...prev, saved: false } : prev
      );
    }
  };

  const handleUnsave = async (guideId: string) => {
    setAllGuides((prev) =>
      prev.map((g) => (g.id === guideId ? { ...g, saved: false } : g))
    );
    setWalletGuides((prev) => prev.filter((g) => g.id !== guideId));
    setPeekGuide((prev) =>
      prev?.id === guideId ? { ...prev, saved: false } : prev
    );
    try {
      await unsaveGuide(guideId);
    } catch {
      showToast("Couldn't unsave, try again");
      // Revert optimistic update
      await fetchData();
    }
  };

  const handleCardClick = (guide: Guide) => {
    setExpandedGuide(guide);
    setEditingGuide(null);
    setEditingGuideId(null);
    window.history.replaceState({}, "", `/guides?id=${guide.id}&tab=${tab}`);
  };

  const handleFork = async (guideId: string) => {
    try {
      const { id } = await forkGuide(guideId);
      setPeekGuide(null);
      await fetchData();
      setTab("wallet");
    } catch (e) {
      console.error("Failed to fork guide:", e);
    }
  };

  const handleEditStart = async (guideId: string) => {
    try {
      const ug = await getUserGuide(guideId);
      setEditingGuide(ug.guide_data);
      setEditingGuideId(guideId);
    } catch (e) {
      console.error("Failed to load guide for editing:", e);
    }
  };

  const handleEditChange = useCallback(
    (updated: RawGuideData) => {
      setEditingGuide(updated);
      setEditSaved(false);
      // Debounced auto-save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (editingGuideId) {
          try {
            await saveUserGuide(editingGuideId, updated);
            setEditSaved(true);
          } catch (e) {
            console.error("Auto-save failed:", e);
          }
        }
      }, 800);
    },
    [editingGuideId]
  );

  const handleEditDone = () => {
    setEditingGuide(null);
    setEditingGuideId(null);
    setExpandedGuide(null);
    fetchData();
  };

  const handleDelete = async (guideId: string) => {
    if (!confirm(t("guides.delete.confirm"))) return;
    try {
      await deleteUserGuide(guideId);
      setExpandedGuide(null);
      setEditingGuide(null);
      fetchData();
    } catch (e) {
      console.error("Failed to delete guide:", e);
    }
  };

  const handleTogglePublish = async (guide: Guide) => {
    // Both publish and unpublish go through the confirmation modal in ExpandedGuideView
    // This is kept for the parent-level state update after confirmation
  };

  const confirmPublishToggle = async () => {
    if (!expandedGuide) return;
    const newStatus = !expandedGuide.is_published;
    try {
      await publishUserGuide(expandedGuide.id, newStatus);
      setExpandedGuide({
        ...expandedGuide,
        is_published: newStatus,
        published_copy_id: newStatus ? "pending" : null,
      });
      fetchData();
    } catch (e) {
      console.error("Failed to toggle publish:", e);
    }
  };

  const handleUpdatePublished = async () => {
    if (!expandedGuide) return;
    try {
      await updatePublishedCopy(expandedGuide.id);
      showToast("Published version synced", "success");
    } catch {
      showToast("Couldn't sync published version, try again");
    }
  };

  const handleToggleLike = async (guideId: string) => {
    try {
      const { liked, count } = await toggleLike("guide", guideId);
      setLikeStatus((prev) => ({ ...prev, [guideId]: { liked, count } }));
    } catch {
      showToast("Couldn't update like, try again");
    }
  };

  const handleShareGuide = async (guide: Guide) => {
    const url = `${window.location.origin}/guides?id=${encodeURIComponent(guide.id)}`;
    const shareData = {
      title: guide.title,
      text: `Check out this playbook: ${guide.title}`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {}
  };

  // Expanded view
  if (expandedGuide) {
    return (
      <ExpandedGuideView
        guide={expandedGuide}
        tab={tab}
        editingGuide={editingGuide}
        editingGuideId={editingGuideId}
        editSaved={editSaved}
        likeStatus={likeStatus}
        returnStepId={returnStepId}
        onClose={() => {
          if (openedViaDeepLink) {
            // Go back to the page that linked here (e.g. landing page)
            window.history.back();
            return;
          }
          setExpandedGuide(null);
          setReturnStepId(null);
          fetchData();
          window.history.replaceState({}, "", `/guides?tab=${tab}`);
        }}
        onEditStart={handleEditStart}
        onEditChange={handleEditChange}
        onEditDone={handleEditDone}
        onDelete={handleDelete}
        onTogglePublish={handleTogglePublish}
        onConfirmPublishToggle={confirmPublishToggle}
        onUpdatePublished={handleUpdatePublished}
        onToggleLike={handleToggleLike}
        onShareGuide={handleShareGuide}
        onUnsave={handleUnsave}
      />
    );
  }

  // Preview view -- read-only fullscreen for explore playbooks
  if (peekGuide) {
    return (
      <PeekGuideView
        guide={peekGuide}
        tab={tab}
        likeStatus={likeStatus}
        onClose={() => {
          setPeekGuide(null);
          window.history.replaceState({}, "", `/guides?tab=${tab}`);
        }}
        onFork={handleFork}
        onToggleLike={handleToggleLike}
        onShareGuide={handleShareGuide}
      />
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-5">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-text-900 tracking-tight">{t("guides.title")}</h1>
            <p className="text-xs text-text-500 mt-0.5">{t("guides.subtitle")}</p>
          </div>
          <button
            onClick={() => router.push("/guides/create")}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sage rounded-full hover:bg-sage-dark transition-all duration-200 hover:scale-105 active:scale-95 min-h-[44px] shadow-sm shadow-sage/10"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("guides.create")}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 bg-surface-200/60 rounded-full p-1">
          <button
            onClick={() => { setTab("wallet"); window.history.replaceState({}, "", "/guides?tab=wallet"); }}
            className={`flex-1 text-sm font-medium py-2.5 min-h-[44px] rounded-full transition-all duration-200 ${
              tab === "wallet"
                ? "bg-white text-text-900 shadow-sm"
                : "text-text-500 hover:text-text-700"
            }`}
          >
            {t("guides.tab.wallet")}
          </button>
          <button
            onClick={() => { setTab("browse"); window.history.replaceState({}, "", "/guides?tab=browse"); }}
            className={`flex-1 text-sm font-medium py-2.5 min-h-[44px] rounded-full transition-all duration-200 ${
              tab === "browse"
                ? "bg-white text-text-900 shadow-sm"
                : "text-text-500 hover:text-text-700"
            }`}
          >
            {t("guides.tab.browse")}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-sage border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === "wallet" ? (
          /* Wallet View -- Sectioned Cards */
          walletGuides.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-200/60 flex items-center justify-center">
                <svg className="w-6 h-6 text-text-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <p className="text-sm text-text-500 mb-3">{t("guides.empty")}</p>
              <button
                onClick={() => { setTab("browse"); window.history.replaceState({}, "", "/guides?tab=browse"); }}
                className="text-xs font-medium text-sage hover:text-sage-dark transition-colors"
              >
                {t("guides.browseCta")}
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {(["published", "private", "liked"] as const).map((cat) => {
                const items = walletGuides.filter((g) => g.wallet_category === cat);
                if (items.length === 0) return null;
                const labels = { published: "Published", private: "Private", liked: "Liked" };
                return (
                  <div key={cat}>
                    <h3 className="text-[11px] font-bold text-text-500 uppercase tracking-widest mb-2.5">
                      {labels[cat]}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {items.map((guide, i) => (
                        <ExploreCard
                          key={guide.id}
                          title={guide.title}
                          icon={guide.icon}
                          color={guide.color}
                          description={guide.description}
                          doneCount={guide.done_count}
                          totalCount={guide.total_count}
                          seasonLabel={guide.season_label}
                          badge={guide.published_copy_id ? "Published" : guide.wallet_category === "private" ? t("guides.custom") : undefined}
                          authorHandle={guide.author_handle}
                          likeCount={likeStatus[guide.id]?.count}
                          index={i}
                          onTap={() => handleCardClick(guide)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Catalog View -- 2-Column Card Grid */
          <div className="grid grid-cols-2 gap-3">
            {allGuides.map((guide, i) => (
              <ExploreCard
                key={guide.id}
                title={guide.title}
                icon={guide.icon}
                color={guide.color}
                description={guide.description}
                totalCount={guide.total_count}
                seasonLabel={guide.season_label}
                saved={guide.saved}
                badge={guide.is_community ? t("guides.community") : undefined}
                authorHandle={guide.author_handle}
                likeCount={likeStatus[guide.id]?.count}
                index={i}
                onTap={() => { setPeekGuide(guide); window.history.replaceState({}, "", `/guides?id=${guide.id}&tab=browse`); }}
              />
            ))}
          </div>
        )}

        {/* Back to home link */}
        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-[11px] font-medium text-text-400 hover:text-sage transition-colors"
          >
            {t("guides.backHome")}
          </a>
        </div>
      </div>

    </div>
  );
}
