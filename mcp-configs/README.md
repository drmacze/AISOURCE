# DLavie OS — MCP Server

**Endpoint:** `https://33935269-8014-42f9-9220-03ad777c8b0e-00-1eoqqeshb7880.pike.replit.dev/api/mcp`

## Tools tersedia (12 tools)

| Tool | Fungsi |
|---|---|
| `system_status` | Cek kesehatan server + status provider AI |
| `dashboard_stats` | Statistik real-time (percakapan, dokumen, training) |
| `chat` | Kirim pesan ke DLavie OS AI (Groq/OpenRouter/Ollama) |
| `list_conversations` | Daftar semua percakapan |
| `create_conversation` | Buat percakapan baru |
| `search_knowledge` | Cari di knowledge base (RAG) |
| `list_documents` | Daftar dokumen di knowledge base |
| `upload_document` | Tambah dokumen ke knowledge base |
| `list_models` | Daftar model AI tersedia |
| `list_datasets` | Daftar dataset training |
| `start_training` | Mulai training job |
| `save_secret` | Simpan API key (HF_TOKEN, GROQ_API_KEY, dll) |

## Setup per aplikasi

### Claude Desktop
Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`):
```json
{
  "mcpServers": {
    "dlavie-os": {
      "url": "https://33935269-8014-42f9-9220-03ad777c8b0e-00-1eoqqeshb7880.pike.replit.dev/api/mcp"
    }
  }
}
```

### Cursor IDE
Buat `.cursor/mcp.json` di root project:
```json
{
  "mcpServers": {
    "dlavie-os": {
      "url": "https://33935269-8014-42f9-9220-03ad777c8b0e-00-1eoqqeshb7880.pike.replit.dev/api/mcp"
    }
  }
}
```

### VS Code
Buat `.vscode/mcp.json` di root project:
```json
{
  "servers": {
    "dlavie-os": {
      "url": "https://33935269-8014-42f9-9220-03ad777c8b0e-00-1eoqqeshb7880.pike.replit.dev/api/mcp",
      "type": "http"
    }
  }
}
```

## Discovery endpoint
```
GET /api/mcp
```
Mengembalikan info server, daftar tools, dan template config siap pakai.
