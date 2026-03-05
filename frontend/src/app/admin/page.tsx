"use client";

import { useState, useEffect, useCallback } from "react";
import {
  uploadDocument,
  getSources,
  deleteSource,
  getKnowledgeStats,
  listUsers,
  updateUserPermissions,
  getModelConfig,
  updateModelConfig,
  type SourceDoc,
  type KnowledgeStats,
  type UserInfo,
  type ModelConfig,
} from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

const VILLAGES = [
  "Great Neck",
  "Great Neck Estates",
  "Great Neck Plaza",
  "Kensington",
  "Kings Point",
  "Thomaston",
];

const CATEGORIES = [
  "codes",
  "permits",
  "garbage",
  "parking",
  "zoning",
  "general",
];

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-500">Loading...</p>
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-700 mb-2">Access Denied</h2>
          <p className="text-sm text-text-500">You need admin permissions to view this page.</p>
        </div>
      </div>
    );
  }

  return <AdminContent />;
}

function AdminContent() {
  // Upload form state
  const [uploadVillage, setUploadVillage] = useState(VILLAGES[0]);
  const [uploadCategory, setUploadCategory] = useState(CATEGORIES[0]);
  const [uploadSource, setUploadSource] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Knowledge store state
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Model config state
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [isUpdatingModel, setIsUpdatingModel] = useState(false);

  // User management state
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const loadModelConfig = useCallback(async () => {
    try {
      const cfg = await getModelConfig();
      setModelConfig(cfg);
    } catch (err) {
      console.error("Failed to load model config", err);
    }
  }, []);

  const handleModelUpdate = async (update: { provider?: string; fast_mode?: boolean }) => {
    setIsUpdatingModel(true);
    try {
      const cfg = await updateModelConfig(update);
      setModelConfig(cfg);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update model config");
    } finally {
      setIsUpdatingModel(false);
    }
  };

  const loadUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    setUserError(null);
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  const handleTogglePermission = async (userId: number, field: "is_admin" | "can_debug", currentValue: boolean) => {
    try {
      await updateUserPermissions(userId, { [field]: currentValue ? 0 : 1 });
      loadUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update permissions");
    }
  };

  const loadData = useCallback(async () => {
    setIsLoadingSources(true);
    setLoadError(null);
    try {
      const [sourcesData, statsData] = await Promise.all([
        getSources(),
        getKnowledgeStats(),
      ]);
      setSources(sourcesData);
      setStats(statsData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load data";
      setLoadError(msg);
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadUsers();
    loadModelConfig();
  }, [loadData, loadUsers, loadModelConfig]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadContent.trim() || !uploadSource.trim()) return;

    setIsUploading(true);
    setUploadStatus(null);

    try {
      const result = await uploadDocument(
        uploadContent,
        uploadSource,
        uploadVillage,
        uploadCategory
      );
      setUploadStatus(
        `Uploaded successfully: ${result.chunks} chunks created`
      );
      setUploadContent("");
      setUploadSource("");
      loadData(); // refresh
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setUploadStatus(`Error: ${msg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (village: string) => {
    if (
      !confirm(
        `Delete all documents for ${village}? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      await deleteSource(village);
      loadData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      alert(msg);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setUploadContent(text);
      if (!uploadSource) {
        setUploadSource(file.name);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-text-900 mb-1">
            Knowledge Base Admin
          </h1>
          <p className="text-sm text-text-600">
            Upload documents, manage sources, and monitor the knowledge store.
          </p>
        </div>

        {/* Model Settings */}
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-900 mb-4">
            Model Settings
          </h2>

          {/* Provider selector */}
          <div className="mb-4">
            <label className="block text-xs text-text-600 mb-2">Provider</label>
            <div className="flex gap-2">
              {(["claude", "gemini"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => handleModelUpdate({ provider: p })}
                  disabled={isUpdatingModel}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    modelConfig?.provider === p
                      ? "bg-sage text-white"
                      : "bg-surface-100 border border-surface-300 text-text-700 hover:bg-surface-300"
                  } disabled:opacity-50`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Models table */}
          {modelConfig && (
            <div className="border border-surface-300 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-300">
                    <th className="text-left px-4 py-2 text-xs text-text-600 font-medium uppercase tracking-wide">
                      Role
                    </th>
                    <th className="text-left px-4 py-2 text-xs text-text-600 font-medium uppercase tracking-wide">
                      Model
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(modelConfig.models).map(([role, model]) => (
                    <tr key={role} className="border-t border-surface-300">
                      <td className="px-4 py-2 text-text-800 font-medium">{role}</td>
                      <td className="px-4 py-2 text-text-600 font-mono text-xs">{model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
            <p className="text-xs text-text-500 uppercase tracking-wide">
              Collections
            </p>
            <p className="text-2xl font-bold text-text-900 mt-1">
              {stats?.collections.length ?? "--"}
            </p>
          </div>
          <div className="bg-surface-200 border border-surface-300 rounded-xl p-4">
            <p className="text-xs text-text-500 uppercase tracking-wide">
              Total Docs
            </p>
            <p className="text-2xl font-bold text-text-900 mt-1">
              {stats?.total_documents ?? "--"}
            </p>
          </div>
          {stats?.collections.slice(0, 2).map((col) => (
            <div
              key={col}
              className="bg-surface-200 border border-surface-300 rounded-xl p-4"
            >
              <p className="text-xs text-text-500 uppercase tracking-wide truncate">
                {col}
              </p>
              <p className="text-2xl font-bold text-text-900 mt-1">
                {stats.per_collection[col] ?? 0}
              </p>
            </div>
          ))}
        </div>

        {/* Upload Form */}
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-text-900 mb-4">
            Upload Document
          </h2>

          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Village selector */}
              <div>
                <label className="block text-xs text-text-600 mb-1">
                  Village
                </label>
                <select
                  value={uploadVillage}
                  onChange={(e) => setUploadVillage(e.target.value)}
                  className="w-full bg-surface-100 border border-surface-300 text-text-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage"
                >
                  {VILLAGES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {/* Category selector */}
              <div>
                <label className="block text-xs text-text-600 mb-1">
                  Category
                </label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full bg-surface-100 border border-surface-300 text-text-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Source name */}
              <div>
                <label className="block text-xs text-text-600 mb-1">
                  Source Name
                </label>
                <input
                  type="text"
                  value={uploadSource}
                  onChange={(e) => setUploadSource(e.target.value)}
                  placeholder="e.g. Chapter 130 - Zoning"
                  className="w-full bg-surface-100 border border-surface-300 text-text-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage placeholder-text-500"
                />
              </div>
            </div>

            {/* File upload */}
            <div>
              <label className="block text-xs text-text-600 mb-1">
                Upload File (optional - .txt, .md, .html)
              </label>
              <input
                type="file"
                accept=".txt,.md,.html,.csv"
                onChange={handleFileUpload}
                className="w-full text-sm text-text-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sage file:text-white hover:file:bg-sage-dark file:cursor-pointer"
              />
            </div>

            {/* Content textarea */}
            <div>
              <label className="block text-xs text-text-600 mb-1">
                Content
              </label>
              <textarea
                value={uploadContent}
                onChange={(e) => setUploadContent(e.target.value)}
                rows={8}
                placeholder="Paste document text content here, or upload a file above..."
                className="w-full bg-surface-100 border border-surface-300 text-text-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage placeholder-text-500 resize-y"
              />
            </div>

            {/* Submit */}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={
                  isUploading || !uploadContent.trim() || !uploadSource.trim()
                }
                className="bg-sage text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-sage-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? "Uploading..." : "Upload Document"}
              </button>

              {uploadStatus && (
                <span
                  className={`text-sm ${
                    uploadStatus.startsWith("Error")
                      ? "text-red-400"
                      : "text-green-400"
                  }`}
                >
                  {uploadStatus}
                </span>
              )}
            </div>
          </form>
        </div>

        {/* User Management */}
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-900">
              User Management
            </h2>
            <button
              onClick={loadUsers}
              disabled={isLoadingUsers}
              className="text-xs text-sage hover:text-sage-dark transition-colors disabled:opacity-50"
            >
              {isLoadingUsers ? "Loading..." : "Refresh"}
            </button>
          </div>

          {userError && (
            <div className="text-sm text-red-400 bg-red-900/20 rounded-lg px-4 py-2 mb-4">
              {userError}
            </div>
          )}

          {users.length === 0 && !isLoadingUsers && !userError && (
            <p className="text-sm text-text-500 text-center py-4">No users yet.</p>
          )}

          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between bg-surface-100 rounded-lg px-4 py-3 border border-surface-300"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-text-900">{u.name || u.email}</span>
                  <span className="text-xs text-text-500 ml-2">{u.email}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={u.is_admin}
                      onChange={() => handleTogglePermission(u.id, "is_admin", u.is_admin)}
                      className="w-3.5 h-3.5 rounded accent-sage"
                    />
                    <span className="text-xs text-text-600">Admin</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={u.can_debug}
                      onChange={() => handleTogglePermission(u.id, "can_debug", u.can_debug)}
                      className="w-3.5 h-3.5 rounded accent-gold"
                    />
                    <span className="text-xs text-text-600">Debug</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sources List */}
        <div className="bg-surface-200 border border-surface-300 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-900">
              Knowledge Sources
            </h2>
            <button
              onClick={loadData}
              disabled={isLoadingSources}
              className="text-xs text-sage hover:text-sage-dark transition-colors disabled:opacity-50"
            >
              {isLoadingSources ? "Loading..." : "Refresh"}
            </button>
          </div>

          {loadError && (
            <div className="text-sm text-red-400 bg-red-900/20 rounded-lg px-4 py-2 mb-4">
              {loadError}
            </div>
          )}

          {sources.length === 0 && !isLoadingSources && !loadError && (
            <p className="text-sm text-text-500 text-center py-8">
              No sources loaded yet. Upload a document to get started.
            </p>
          )}

          <div className="space-y-2">
            {sources.map((src, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-surface-100 rounded-lg px-4 py-3 border border-surface-300"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-text-900 truncate">
                      {src.source}
                    </span>
                    <span className="text-xs bg-surface-300 text-text-700 px-2 py-0.5 rounded">
                      {src.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-text-500">
                    <span>{src.village}</span>
                    <span>{src.chunk_count} chunks</span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(src.village)}
                  className="flex-shrink-0 text-xs text-red-400 hover:text-red-300 transition-colors ml-4"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
