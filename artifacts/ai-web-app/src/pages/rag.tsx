import React, { useCallback, useRef } from "react";
import {
  useListDocuments,
  useUploadDocument,
  useDeleteDocument,
  useSearchDocuments,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Database, Upload, Search, FileText, Trash2, Loader2,
  Hash, Layers, CheckCircle2, AlertCircle, X, Eye, CloudUpload, Link,
} from "lucide-react";
import { format } from "date-fns";

const API_BASE = (import.meta.env.VITE_API_URL as string || "").replace(/\/$/, "");

export default function Rag() {
  const queryClient = useQueryClient();
  const { data: documents, isLoading } = useListDocuments();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [uploadTitle, setUploadTitle] = React.useState("");
  const [uploadContent, setUploadContent] = React.useState("");
  const [isUploadOpen, setIsUploadOpen] = React.useState(false);
  const [previewDoc, setPreviewDoc] = React.useState<null | { title: string; content: string }>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStatus, setDragStatus] = React.useState<"idle" | "uploading" | "done" | "error">("idle");
  const [dragMsg, setDragMsg] = React.useState("");
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL import state
  const [isUrlOpen, setIsUrlOpen] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState("");
  const [urlStatus, setUrlStatus] = React.useState<"idle" | "loading" | "done" | "error">("idle");
  const [urlMsg, setUrlMsg] = React.useState("");

  const handleUrlImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setUrlStatus("loading");
    setUrlMsg("Fetching & indexing…");
    try {
      const res = await fetch(`${API_BASE}/api/documents/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUrlStatus("done");
      setUrlMsg(`✅ "${data.title}" indexed — ${data.chunkCount} chunks`);
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      setTimeout(() => { setIsUrlOpen(false); setUrlInput(""); setUrlStatus("idle"); setUrlMsg(""); }, 2000);
    } catch (err) {
      setUrlStatus("error");
      setUrlMsg(`Error: ${String(err)}`);
    }
  };

  const uploadMutation = useUploadDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        setIsUploadOpen(false);
        setUploadTitle("");
        setUploadContent("");
      },
    },
  });

  const deleteMutation = useDeleteDocument({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() }),
    },
  });

  const searchMutation = useSearchDocuments();

  const handleUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadTitle || !uploadContent) return;
    uploadMutation.mutate({ data: { title: uploadTitle, content: uploadContent } });
  };

  // Upload any file — uses multipart endpoint for PDF/DOCX, JSON endpoint for text
  const uploadFile = useCallback(
    async (file: File) => {
      if (!file) return;

      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isBinary = ["pdf", "docx"].includes(ext) ||
        file.type === "application/pdf" ||
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      const accepted = isBinary ||
        file.type.startsWith("text/") ||
        ["txt", "md", "csv", "json"].includes(ext);

      if (!accepted) {
        setDragStatus("error");
        setDragMsg(`Unsupported: ${file.name}. Allowed: PDF, DOCX, TXT, MD, CSV, JSON`);
        setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 4000);
        return;
      }

      setDragStatus("uploading");
      setDragMsg(`Processing ${file.name}...`);

      if (isBinary) {
        // Use multipart upload — server extracts text from PDF/DOCX
        const formData = new FormData();
        formData.append("file", file);
        try {
          const res = await fetch(`${API_BASE}/api/documents/upload`, {
            method: "POST",
            body: formData,
          });
          const data = await res.json() as { title?: string; chunkCount?: number; wordCount?: number; error?: string };
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          setDragStatus("done");
          setDragMsg(`✅ "${data.title || file.name}" — ${data.wordCount?.toLocaleString() ?? "?"} words, ${data.chunkCount} chunks`);
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 4000);
        } catch (err) {
          setDragStatus("error");
          setDragMsg(`Error: ${String(err)}`);
          setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 4000);
        }
        return;
      }

      // Text files — read client-side and use JSON endpoint
      const reader = new FileReader();
      reader.onload = (ev) => {
        const content = ev.target?.result as string;
        const title = file.name.replace(/\.[^/.]+$/, "");
        setDragMsg(`Indexing "${title}"...`);
        uploadMutation.mutate(
          { data: { title, content } },
          {
            onSuccess: () => {
              setDragStatus("done");
              setDragMsg(`✅ "${title}" indexed successfully`);
              setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 3000);
            },
            onError: (err) => {
              setDragStatus("error");
              setDragMsg(`Error: ${String(err)}`);
              setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 4000);
            },
          }
        );
      };
      reader.onerror = () => {
        setDragStatus("error");
        setDragMsg("Could not read file");
        setTimeout(() => { setDragStatus("idle"); setDragMsg(""); }, 3000);
      };
      reader.readAsText(file);
    },
    [uploadMutation, queryClient]
  );

  // Open dialog with file content for review before upload (text files only)
  const previewFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isBinary = ["pdf", "docx"].includes(ext);
    if (isBinary) { uploadFile(file); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
      setUploadContent(content);
      setIsUploadOpen(true);
    };
    reader.readAsText(file);
  }, [uploadFile]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile]
  );

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) previewFile(file);
    e.target.value = "";
  };

  const totalChunks = documents?.reduce((s, d) => s + (d.chunkCount || 0), 0) || 0;
  const totalSize = documents?.reduce((s, d) => s + (d.size || 0), 0) || 0;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-sans tracking-tight mb-1.5">Knowledge Base</h1>
          <p className="text-muted-foreground font-mono text-sm">
            RAG · Vector search (HF embeddings) · BM25 fallback · PDF/DOCX parsing · URL import
          </p>
        </div>
        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          {/* URL Import dialog */}
          <Dialog open={isUrlOpen} onOpenChange={setIsUrlOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 font-mono">
                <CloudUpload className="w-4 h-4" />
                IMPORT_URL
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] border-border bg-card">
              <DialogHeader>
                <DialogTitle className="font-sans">Import URL to Knowledge Base</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleUrlImport} className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium font-mono text-muted-foreground">URL</label>
                  <Input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://docs.example.com/getting-started"
                    className="font-mono bg-background"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The page will be fetched, HTML stripped, and text indexed into your knowledge base automatically.
                  </p>
                </div>
                {urlMsg && (
                  <div className={`text-xs font-mono px-3 py-2 rounded ${
                    urlStatus === "error" ? "text-red-400 bg-red-500/10" :
                    urlStatus === "done"  ? "text-green-400 bg-green-500/10" :
                    "text-primary/80 bg-primary/5"
                  }`}>{urlMsg}</div>
                )}
                <Button type="submit" className="w-full" disabled={urlStatus === "loading" || !urlInput.trim()}>
                  {urlStatus === "loading" ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importing…</> : <><CloudUpload className="w-4 h-4 mr-2" />Fetch & Index</>}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 font-mono">
                <Upload className="w-4 h-4" />
                ADD_DOCUMENT
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-[560px] border-border bg-card">
            <DialogHeader>
              <DialogTitle className="font-sans">Index New Document</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleUpload} className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium font-mono text-muted-foreground">DOCUMENT_TITLE</label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  required
                  className="font-sans bg-background"
                  placeholder="e.g. Product Documentation"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium font-mono text-muted-foreground">RAW_CONTENT</label>
                  <label className="flex items-center gap-1 text-[10px] font-mono text-primary hover:underline cursor-pointer">
                    <Upload className="w-3 h-3" />
                    import file
                    <input type="file" accept=".txt,.md,.csv,.json" className="hidden" onChange={handleFileInput} />
                  </label>
                </div>
                <textarea
                  value={uploadContent}
                  onChange={(e) => setUploadContent(e.target.value)}
                  required
                  className="flex min-h-[180px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
                  placeholder="Paste document content here, or import a file above..."
                />
              </div>
              {uploadContent && (
                <div className="flex gap-4 text-xs font-mono text-muted-foreground bg-accent/30 px-3 py-2 rounded-md">
                  <span>{uploadContent.length.toLocaleString()} chars</span>
                  <span>{uploadContent.split(/\s+/).length.toLocaleString()} words</span>
                  <span>~{Math.ceil(uploadContent.length / 500)} chunks</span>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={uploadMutation.isPending || !uploadTitle || !uploadContent}>
                {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Process & Index Document
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Documents", value: documents?.length ?? 0, icon: FileText, color: "text-violet-400", bg: "bg-violet-500/10" },
          { label: "Chunks", value: totalChunks, icon: Hash, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "Storage", value: totalSize > 1024 ? `${(totalSize / 1024).toFixed(1)}kb` : `${totalSize}b`, icon: Layers, color: "text-emerald-400", bg: "bg-emerald-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="flex items-center gap-3 p-3 sm:p-4 rounded-xl border border-white/5 bg-slate-900/40">
            <div className={`p-2 rounded-lg ${bg} hidden sm:flex`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <p className={`text-lg sm:text-xl font-bold font-mono ${color}`}>{value}</p>
              <p className="text-xs text-muted-foreground font-mono">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Document list */}
        <div className="lg:col-span-2 space-y-4">
          {/* Drag & drop zone — fixed: handles DragEnter, DragLeave, DragOver, Drop correctly */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer select-none
              ${isDragging
                ? "border-primary bg-primary/10 scale-[1.01] shadow-lg shadow-primary/10"
                : dragStatus === "done"
                  ? "border-green-500 bg-green-500/5"
                  : dragStatus === "error"
                    ? "border-red-500 bg-red-500/5"
                    : dragStatus === "uploading"
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-accent/20"
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.json"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
            />

            {dragStatus === "uploading" ? (
              <>
                <Loader2 className="w-8 h-8 mx-auto mb-3 text-primary animate-spin" />
                <p className="text-sm font-mono text-primary">{dragMsg}</p>
              </>
            ) : dragStatus === "done" ? (
              <>
                <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-green-400" />
                <p className="text-sm font-mono text-green-400">{dragMsg}</p>
              </>
            ) : dragStatus === "error" ? (
              <>
                <AlertCircle className="w-8 h-8 mx-auto mb-3 text-red-400" />
                <p className="text-sm font-mono text-red-400">{dragMsg}</p>
              </>
            ) : isDragging ? (
              <>
                <CloudUpload className="w-10 h-10 mx-auto mb-3 text-primary animate-bounce" />
                <p className="text-base font-mono text-primary font-medium">Drop to upload & index instantly</p>
              </>
            ) : (
              <>
                <CloudUpload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-mono text-muted-foreground">
                  <span className="text-primary font-medium">Drag & drop</span> a file here, or{" "}
                  <span className="text-primary font-medium underline">click to browse</span>
                </p>
                <p className="text-xs font-mono text-muted-foreground/60 mt-1">
                  PDF · DOCX · TXT · MD · CSV · JSON — real text extraction + vector indexing
                </p>
              </>
            )}
          </div>

          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Database className="w-5 h-5 text-primary" />
                Indexed Repository
                {documents?.length ? (
                  <span className="ml-auto text-xs font-mono text-muted-foreground font-normal">
                    {documents.length} document{documents.length !== 1 ? "s" : ""}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : documents?.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground font-mono border border-dashed border-border rounded-lg bg-background/50">
                  <FileText className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  <p>Repository is empty</p>
                  <p className="text-xs mt-1 opacity-60">Drag & drop a file above or click "ADD_DOCUMENT"</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents?.map((doc) => (
                    <div
                      key={doc.id}
                      className="group flex items-start justify-between p-4 rounded-xl border border-border bg-background hover:border-primary/40 transition-all"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="mt-0.5 p-2 rounded-lg bg-accent/50 text-primary shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-medium text-sm truncate">{doc.title}</h4>
                          {doc.content && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                              {doc.content.slice(0, 120)}...
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-mono text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Hash className="w-3 h-3" /> {doc.chunkCount} chunks
                            </span>
                            <span className="flex items-center gap-1">
                              <Layers className="w-3 h-3" /> {Math.round((doc.size || 0) / 1024)}kb
                            </span>
                            <span>{format(new Date(doc.createdAt), "MMM d, yyyy")}</span>
                            {doc.indexed ? (
                              <span className="text-green-500 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> INDEXED
                              </span>
                            ) : (
                              <span className="text-orange-500 animate-pulse flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> PROCESSING
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                          onClick={() => setPreviewDoc({ title: doc.title, content: doc.content || "" })}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMutation.mutate({ id: doc.id })}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Search */}
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Search className="w-4 h-4 text-primary" />
                Semantic Search
              </CardTitle>
              <CardDescription className="font-mono text-xs">Test RAG retrieval accuracy</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); if (searchQuery) searchMutation.mutate({ data: { query: searchQuery } }); }} className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Enter query..."
                    className="pl-9 font-mono text-sm bg-background"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  variant="secondary"
                  disabled={!searchQuery || searchMutation.isPending}
                >
                  {searchMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Search className="w-4 h-4 mr-2" />
                  )}
                  Run Query
                </Button>
              </form>

              {searchMutation.data && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium font-mono text-muted-foreground uppercase tracking-widest">BM25 Results</h4>
                    <span className="text-[10px] font-mono text-muted-foreground">{searchMutation.data.length} match{searchMutation.data.length !== 1 ? "es" : ""}</span>
                  </div>
                  {searchMutation.data.length === 0 ? (
                    <div className="text-xs text-center text-muted-foreground font-mono py-4 bg-accent/20 rounded-lg">No matches in knowledge base.</div>
                  ) : (
                    searchMutation.data.map((res: { title: string; score: number; snippet?: string; content?: string; rank?: number; chunkCount?: number }, i: number) => {
                      const maxScore = searchMutation.data![0].score || 1;
                      const pct = Math.min(100, Math.round((res.score / maxScore) * 100));
                      return (
                        <div key={i} className="p-3 rounded-lg bg-accent/30 border border-border text-sm space-y-2">
                          <div className="flex justify-between items-center gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{res.rank ?? i+1}</span>
                              <span className="font-medium text-primary text-xs truncate">{res.title}</span>
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground shrink-0 bg-accent px-1.5 py-0.5 rounded">
                              BM25: {res.score?.toFixed(2)}
                            </span>
                          </div>
                          <div className="h-1 bg-accent rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed font-mono">
                            {res.snippet || (res.content || "").slice(0, 200)}
                          </p>
                          {res.chunkCount !== undefined && (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono">
                              <Hash className="w-3 h-3" />{res.chunkCount} chunks in document
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* How RAG works */}
          <Card className="glass-panel border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono text-muted-foreground uppercase tracking-widest">How RAG Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { step: "1", label: "Index", desc: "Documents are chunked and indexed in the database" },
                { step: "2", label: "Retrieve", desc: "On each chat message, relevant chunks are retrieved" },
                { step: "3", label: "Augment", desc: "Retrieved context is injected into the AI prompt" },
                { step: "4", label: "Generate", desc: "AI responds with grounded, accurate answers" },
              ].map((item) => (
                <div key={item.step} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-mono font-bold shrink-0 mt-0.5">{item.step}</span>
                  <div>
                    <p className="text-xs font-medium font-mono text-foreground">{item.label}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Document preview modal */}
      {previewDoc && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-medium font-sans">{previewDoc.title}</h3>
              <button onClick={() => setPreviewDoc(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-relaxed">{previewDoc.content}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
