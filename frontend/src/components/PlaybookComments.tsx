"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";
import MentionInput from "@/components/MentionInput";
import {
  getComments,
  postComment,
  deleteComment,
  toggleLike,
  type Comment,
} from "@/lib/api";

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function renderBody(body: string): React.ReactNode {
  // Render @mentions as styled links
  const parts = body.split(/(@[a-z0-9][a-z0-9-]{1,18}[a-z0-9])/g);
  return parts.map((part, i) => {
    if (part.startsWith("@") && /^@[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(part)) {
      const handle = part.slice(1);
      return (
        <a
          key={i}
          href={`/profile/?h=${handle}`}
          className="text-sage font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface PlaybookCommentsProps {
  guideId: string;
  commentCount: number;
  readOnly?: boolean;
}

export default function PlaybookComments({ guideId, commentCount, readOnly = false }: PlaybookCommentsProps) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [count, setCount] = useState(commentCount);

  const loadComments = useCallback(
    async (afterId?: number) => {
      setLoading(true);
      try {
        const { comments: fetched, has_more } = await getComments(guideId, afterId, 30);
        if (afterId) {
          setComments((prev) => [...prev, ...fetched]);
        } else {
          setComments(fetched);
        }
        setHasMore(has_more);
      } catch {}
      setLoading(false);
    },
    [guideId]
  );

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  const handlePost = async () => {
    if (!newComment.trim() || posting) return;
    setPosting(true);
    try {
      const comment = await postComment(guideId, newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment("");
      setCount((c) => c + 1);
    } catch {}
    setPosting(false);
  };

  const handleDelete = async (commentId: number) => {
    try {
      await deleteComment(guideId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setCount((c) => Math.max(c - 1, 0));
    } catch {}
  };

  const handleUpvote = async (commentId: number) => {
    try {
      const { liked, count: newCount } = await toggleLike("comment", String(commentId));
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, upvote_count: newCount, user_upvoted: liked }
            : c
        )
      );
    } catch {}
  };

  const loadMore = () => {
    if (comments.length > 0) {
      loadComments(comments[comments.length - 1].id);
    }
  };

  return (
    <div className="mt-4 border-t border-surface-100 pt-4">
      <h4 className="text-sm font-semibold text-text-700 mb-3">
        Comments {count > 0 && <span className="text-text-400 font-normal">({count})</span>}
      </h4>

      {/* Comment list */}
      <div className="space-y-3 mb-3">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2.5">
            {c.user.avatar_url ? (
              <img
                src={c.user.avatar_url}
                alt=""
                className="w-7 h-7 rounded-full flex-shrink-0 mt-0.5"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-sage/20 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-medium text-sage">
                {c.user.name?.[0] || "?"}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                {c.user.handle ? (
                  <a href={`/profile/?h=${c.user.handle}`} className="text-xs font-semibold text-text-700 hover:underline">
                    @{c.user.handle}
                  </a>
                ) : (
                  <span className="text-xs font-semibold text-text-700">{c.user.name}</span>
                )}
                <span className="text-[10px] text-text-400">{timeAgo(c.created_at)}</span>
              </div>
              <p className="text-sm text-text-600 mt-0.5 whitespace-pre-wrap break-words">
                {renderBody(c.body)}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <button
                  onClick={() => handleUpvote(c.id)}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    c.user_upvoted
                      ? "text-sage font-medium"
                      : "text-text-400 hover:text-text-600"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill={c.user_upvoted ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                  </svg>
                  {c.upvote_count > 0 && c.upvote_count}
                </button>
                {user && user.handle && c.user.handle === user.handle && (
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-xs text-text-400 hover:text-red-500 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-center py-3">
            <div className="w-5 h-5 border-2 border-sage/30 border-t-sage rounded-full animate-spin" />
          </div>
        )}

        {hasMore && !loading && (
          <button
            onClick={loadMore}
            className="text-xs text-sage hover:text-sage/80 font-medium"
          >
            Load more comments
          </button>
        )}
      </div>

      {/* New comment input */}
      {readOnly ? (
        comments.length > 0 ? (
          <p className="text-xs text-text-400 text-center py-2">
            Comments are frozen — publish this playbook to allow new comments
          </p>
        ) : null
      ) : user ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <MentionInput
              value={newComment}
              onChange={setNewComment}
              onSubmit={handlePost}
              placeholder="Write a comment... (use @handle to mention)"
              disabled={posting}
            />
          </div>
          <button
            onClick={handlePost}
            disabled={!newComment.trim() || posting}
            className={`self-end px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
              newComment.trim() && !posting
                ? "bg-sage text-white hover:bg-sage/90"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {posting ? "..." : "Post"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-text-400 text-center py-2">
          Sign in to comment
        </p>
      )}
    </div>
  );
}
