"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getPublicProfile, type PublicProfile } from "@/lib/api";

function ProfileInner() {
  const searchParams = useSearchParams();
  const handle = searchParams.get("h") || "";

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) {
      setError("No handle specified");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getPublicProfile(handle)
      .then(setProfile)
      .catch(() => setError("Profile not found"))
      .finally(() => setLoading(false));
  }, [handle]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sage/30 border-t-sage rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text-800 mb-2">Profile not found</h1>
          <p className="text-text-500">The user @{handle} doesn&apos;t exist.</p>
          <a href="/" className="inline-block mt-4 text-sage hover:underline text-sm">
            Go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50">
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-surface-100 p-6 text-center">
          {profile.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt={profile.name}
              className="w-20 h-20 rounded-full mx-auto mb-3"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-sage/20 mx-auto mb-3 flex items-center justify-center text-2xl font-semibold text-sage">
              {profile.name?.[0] || "?"}
            </div>
          )}

          <h1 className="text-xl font-bold text-text-800">{profile.name}</h1>
          <p className="text-sm text-text-400 mt-0.5">@{profile.handle}</p>

          {profile.bio && (
            <p className="text-sm text-text-600 mt-3 max-w-sm mx-auto">{profile.bio}</p>
          )}

          <div className="mt-4 pt-4 border-t border-surface-100">
            <div className="text-center">
              <span className="text-lg font-bold text-text-800">{profile.published_playbooks_count}</span>
              <span className="text-sm text-text-400 ml-1">
                {profile.published_playbooks_count === 1 ? "playbook" : "playbooks"} published
              </span>
            </div>
          </div>
        </div>

        <div className="text-center mt-6">
          <a href="/" className="text-sm text-text-400 hover:text-text-600 transition-colors">
            &larr; Back to GreatNeck.ai
          </a>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileInner />
    </Suspense>
  );
}
