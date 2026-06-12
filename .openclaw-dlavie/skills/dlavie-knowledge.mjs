
/**
 * DLavie OS Knowledge Base Skills — for librarian agent
 */
const BASE = "http://127.0.0.1:3000";
async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.ok ? res.json() : { error: `${res.status}: ${await res.text()}` };
}

export const tools = [
  {
    name: "kb_list_documents",
    description: "List all documents in the DLavie OS knowledge base.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/documents"); },
  },
  {
    name: "kb_add_document",
    description: "Add a text document to the knowledge base for RAG.",
    inputSchema: {
      type: "object",
      properties: {
        title:   { type: "string" },
        content: { type: "string" },
        tags:    { type: "string", description: "Comma-separated tags" },
      },
      required: ["title", "content"],
    },
    async execute({ title, content, tags = "" }) {
      return api("/api/documents", "POST", { title, content, tags });
    },
  },
  {
    name: "kb_search",
    description: "Search the knowledge base with hybrid/semantic/keyword search.",
    inputSchema: {
      type: "object",
      properties: {
        query:  { type: "string" },
        method: { type: "string", enum: ["hybrid", "semantic", "keyword"] },
        limit:  { type: "number" },
      },
      required: ["query"],
    },
    async execute({ query, method = "hybrid", limit = 10 }) {
      return api("/api/documents/search", "POST", { query, method, limit });
    },
  },
  {
    name: "kb_import_url",
    description: "Import a web page or URL into the knowledge base.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "URL to import" } },
      required: ["url"],
    },
    async execute({ url }) { return api("/api/documents/import-url", "POST", { url }); },
  },
  {
    name: "kb_delete_document",
    description: "Delete a document from the knowledge base by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Document ID" } },
      required: ["id"],
    },
    async execute({ id }) { return api(`/api/documents/${id}`, "DELETE"); },
  },
  {
    name: "kb_reembed_all",
    description: "Trigger re-embedding of all documents to refresh search index.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/documents/reembed-all", "POST"); },
  },
  {
    name: "kb_scrape_url",
    description: "Scrape a URL and return its text content for processing.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    async execute({ url }) { return api("/api/autotraining/scrape-url", "POST", { url }); },
  },
  {
    name: "kb_autotraining_sources",
    description: "List and manage auto-training data sources.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() { return api("/api/autotraining/sources"); },
  },
];
