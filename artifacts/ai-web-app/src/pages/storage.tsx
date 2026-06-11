/**
 * DLavie OS — OneDrive Storage
 * Microsoft OneDrive 1TB integration via Microsoft Graph API + Device Code OAuth
 */

import { useState, useEffect, useRef } from "react";
import {
  HardDrive, Cloud, CloudOff, Folder, File, RefreshCw, Upload,
  Link2, CheckCircle2, XCircle, Loader2, Search, Trash2, Database,
  AlertTriangle, Info, CloudUpload, LogOut, FolderOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType: string };
  folder?: { childCount: number };
  lastModifiedDateTime: string;
  webUrl: string;
}

interface DriveStatus {
  connected: boolean;
  clientId?: string;
  user?: { displayName: string; mail: string };
  quota?: { totalGB: number; usedGB: number; remainingGB: number; usedPercent: number };
  error?: string;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function StoragePage() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveItem[]>([]);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DriveItem[] | null>(null);
  const [clientId, setClientId] = useState("");
  const [authStep, setAuthStep] = useState<"idle" | "waiting" | "done">("idle");
  const [deviceInfo, setDeviceInfo] = useState<{ userCode: string; verificationUri: string; deviceCode: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  useEffect(() => {
    loadStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/onedrive/status");
      const data = await res.json() as DriveStatus;
      setStatus(data);
      if (data.connected) loadFiles();
    } catch { setError("Failed to load OneDrive status"); }
    finally { setLoading(false); }
  }

  async function loadFiles(folderId?: string) {
    setFilesLoading(true);
    setSearchResults(null);
    try {
      const url = folderId ? `/api/onedrive/files?folderId=${folderId}` : "/api/onedrive/files";
      const res = await fetch(url);
      const data = await res.json() as { files: DriveItem[] };
      setFiles(data.files || []);
    } catch { setError("Failed to load files"); }
    finally { setFilesLoading(false); }
  }

  async function startAuth() {
    if (!clientId.trim()) { setError("Enter your Azure App Client ID first"); return; }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/onedrive/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientId.trim() }),
      });
      const data = await res.json() as { userCode: string; verificationUri: string; deviceCode: string; error?: string };
      if (!res.ok) { setError(data.error || "Auth failed"); return; }
      setDeviceInfo(data);
      setAuthStep("waiting");
      pollRef.current = setInterval(async () => {
        const pr = await fetch("/api/onedrive/auth/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceCode: data.deviceCode, clientId: clientId.trim() }),
        });
        const pd = await pr.json() as { status: string };
        if (pd.status === "connected") {
          clearInterval(pollRef.current!);
          setAuthStep("done");
          await loadStatus();
        } else if (pd.status === "error") {
          clearInterval(pollRef.current!);
          setError("Authentication failed. Try again.");
          setAuthStep("idle");
        }
      }, 3000);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function disconnect() {
    await fetch("/api/onedrive/auth/disconnect", { method: "POST" });
    setStatus(null);
    setFiles([]);
    setFolderStack([]);
    await loadStatus();
  }

  async function doSearch() {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setFilesLoading(true);
    try {
      const res = await fetch(`/api/onedrive/search?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json() as { files: DriveItem[] };
      setSearchResults(data.files || []);
    } catch { setError("Search failed"); }
    finally { setFilesLoading(false); }
  }

  async function syncToRag() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const body = selectedFiles.size > 0
        ? { fileIds: [...selectedFiles], folderId: currentFolderId }
        : { folderId: currentFolderId };
      const res = await fetch("/api/onedrive/sync-to-rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { synced: number; failed: number };
      setSyncResult(data);
    } catch { setError("Sync failed"); }
    finally { setSyncing(false); }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this file from OneDrive? This cannot be undone.")) return;
    await fetch(`/api/onedrive/files/${id}`, { method: "DELETE" });
    loadFiles(currentFolderId);
  }

  function openFolder(item: DriveItem) {
    setFolderStack((s) => [...s, { id: item.id, name: item.name }]);
    loadFiles(item.id);
    setSelectedFiles(new Set());
  }

  function goUp() {
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    loadFiles(newStack.length > 0 ? newStack[newStack.length - 1].id : undefined);
    setSelectedFiles(new Set());
  }

  function goToRoot() {
    setFolderStack([]);
    loadFiles();
    setSelectedFiles(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedFiles((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const displayFiles = searchResults ?? files;

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Header */}
      <div className="flex-none border-b border-slate-800/60 bg-slate-900/40 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">OneDrive Storage</h1>
              <p className="text-xs text-slate-400">Microsoft OneDrive — sync documents to Knowledge Base</p>
            </div>
          </div>
          {status?.connected && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="w-3 h-3" />
                {status.user?.displayName}
              </div>
              <button onClick={disconnect} className="text-xs text-slate-500 hover:text-red-400 transition-colors px-2 py-1">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-300">Dismiss</button>
          </div>
        )}

        {/* Not connected */}
        {!status?.connected && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Setup instructions */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <CloudOff className="w-5 h-5 text-slate-400" />
                <h2 className="text-sm font-semibold text-white">Connect Microsoft OneDrive</h2>
              </div>
              <div className="space-y-3 text-xs text-slate-400">
                <p className="text-slate-300">Langkah untuk menghubungkan OneDrive 1TB Anda:</p>
                <ol className="space-y-2 list-decimal list-inside">
                  <li>Buka <a href="https://portal.azure.com" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">portal.azure.com</a></li>
                  <li>Klik <strong className="text-slate-200">App registrations</strong> → <strong className="text-slate-200">New registration</strong></li>
                  <li>Name: bebas (misal "DLavie OneDrive")</li>
                  <li>Account types: <strong className="text-slate-200">Personal Microsoft accounts only</strong></li>
                  <li>Setelah dibuat, salin <strong className="text-slate-200">Application (client) ID</strong></li>
                  <li>Klik <strong className="text-slate-200">Authentication</strong> → <strong className="text-slate-200">Allow public client flows</strong> → Yes → Save</li>
                </ol>
              </div>
              <div className="flex items-start gap-2 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-300">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>Tidak perlu client secret. Gratis — Azure free tier sudah cukup.</span>
              </div>
            </div>

            {/* Auth form */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-white">Connect Account</h2>

              {authStep === "idle" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Azure App Client ID</label>
                    <input
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={startAuth}
                    disabled={loading || !clientId.trim()}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Connect OneDrive
                  </button>
                </div>
              )}

              {authStep === "waiting" && deviceInfo && (
                <div className="space-y-4">
                  <div className="text-center space-y-3">
                    <p className="text-xs text-slate-400">Buka URL ini di browser:</p>
                    <a
                      href={deviceInfo.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline text-sm font-medium block"
                    >
                      {deviceInfo.verificationUri}
                    </a>
                    <p className="text-xs text-slate-400">Masukkan kode ini:</p>
                    <div className="inline-block bg-slate-800 border border-slate-600 rounded-xl px-6 py-3">
                      <span className="text-3xl font-mono font-bold text-white tracking-[0.3em]">
                        {deviceInfo.userCode}
                      </span>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Menunggu konfirmasi...
                    </div>
                  </div>
                </div>
              )}

              {authStep === "done" && (
                <div className="text-center text-emerald-400 space-y-2 py-4">
                  <CheckCircle2 className="w-8 h-8 mx-auto" />
                  <p className="text-sm font-medium">Connected!</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connected */}
        {status?.connected && (
          <>
            {/* Quota */}
            {status.quota && (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-blue-400" />
                    <span className="text-sm text-white">{status.quota.usedGB} GB used of {status.quota.totalGB} GB</span>
                  </div>
                  <span className="text-xs text-slate-400">{status.quota.remainingGB} GB remaining</span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${status.quota.usedPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Breadcrumb */}
              <div className="flex items-center gap-1 text-xs text-slate-400 flex-1 min-w-0">
                <button onClick={goToRoot} className="hover:text-white transition-colors">Root</button>
                {folderStack.map((f, i) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <span>/</span>
                    <button
                      onClick={() => {
                        const newStack = folderStack.slice(0, i + 1);
                        setFolderStack(newStack);
                        loadFiles(f.id);
                      }}
                      className="hover:text-white transition-colors truncate max-w-[120px]"
                    >
                      {f.name}
                    </button>
                  </span>
                ))}
              </div>

              {/* Search */}
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-800/60 border border-slate-700 rounded-lg overflow-hidden">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                    placeholder="Search OneDrive..."
                    className="bg-transparent px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none w-40"
                  />
                  <button onClick={doSearch} className="px-2 py-1.5 text-slate-400 hover:text-white">
                    <Search className="w-3.5 h-3.5" />
                  </button>
                </div>
                {searchResults && (
                  <button onClick={() => { setSearchResults(null); setSearchQuery(""); }} className="text-xs text-slate-400 hover:text-white">
                    Clear
                  </button>
                )}
              </div>

              {folderStack.length > 0 && (
                <button onClick={goUp} className="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                  ↑ Up
                </button>
              )}

              <button onClick={() => loadFiles(currentFolderId)} className="text-xs text-slate-400 hover:text-white">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Sync to RAG button */}
            <div className="flex items-center gap-3">
              <button
                onClick={syncToRag}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                {selectedFiles.size > 0 ? `Sync ${selectedFiles.size} files to Knowledge Base` : "Sync folder to Knowledge Base"}
              </button>
              {syncResult && (
                <div className={cn("text-xs px-3 py-1.5 rounded-lg border", syncResult.synced > 0 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-slate-400 bg-slate-800 border-slate-700")}>
                  {syncResult.synced} synced, {syncResult.failed} failed
                </div>
              )}
            </div>

            {/* File list */}
            {filesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 overflow-hidden">
                {displayFiles.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-sm">
                    {searchResults ? "No results found" : "This folder is empty"}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {displayFiles.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors group",
                          selectedFiles.has(item.id) && "bg-blue-500/10"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          className="flex-shrink-0"
                        />
                        <div
                          className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                          onClick={() => item.folder ? openFolder(item) : undefined}
                        >
                          {item.folder ? (
                            <FolderOpen className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          ) : (
                            <File className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          )}
                          <span className={cn("text-sm truncate", item.folder ? "text-yellow-200 font-medium" : "text-slate-200")}>
                            {item.name}
                          </span>
                          {item.folder && <span className="text-xs text-slate-500">({item.folder.childCount} items)</span>}
                        </div>
                        <span className="text-xs text-slate-500 flex-shrink-0">{formatSize(item.size)}</span>
                        <span className="text-xs text-slate-600 flex-shrink-0 w-16 text-right">{timeAgo(item.lastModifiedDateTime)}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <a href={item.webUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:text-blue-300 px-1.5 py-0.5 hover:bg-blue-500/10 rounded">
                            Open
                          </a>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
