/**
 * DLavie OS — Microsoft OneDrive Integration
 * Uses Microsoft Graph API with OAuth2 Device Code Flow (no client secret needed).
 * Supports personal Microsoft accounts (consumers tenant).
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const GRAPH_API = "https://graph.microsoft.com/v1.0";
const AUTH_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPES = "Files.ReadWrite.All offline_access User.Read";
const CONFIG_PATH = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-config.json"
);

export interface DriveItem {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType: string };
  folder?: { childCount: number };
  lastModifiedDateTime: string;
  webUrl: string;
  parentReference?: { id: string; path: string };
}

export interface DriveQuota {
  total: number;
  used: number;
  remaining: number;
  state: string;
}

function loadConfig(): Record<string, unknown> {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch { /* ignore */ }
  return {};
}

function saveConfig(cfg: Record<string, unknown>): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch { /* ignore */ }
}

function persistToken(key: string, value: string): void {
  const cfg = loadConfig();
  if (!cfg.secrets) cfg.secrets = {};
  (cfg.secrets as Record<string, string>)[key] = value;
  process.env[key] = value;
  saveConfig(cfg);
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function isOneDriveConfigured(): boolean {
  return !!(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_REFRESH_TOKEN);
}

export function getOneDriveClientId(): string | undefined {
  return process.env.ONEDRIVE_CLIENT_ID;
}

// ─── OAuth Device Code Flow ──────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message: string;
}

export async function startDeviceAuth(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(`${AUTH_BASE}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Device code error: ${text}`);
  }
  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollDeviceAuth(
  clientId: string,
  deviceCode: string
): Promise<{ access_token: string; refresh_token: string } | { pending: true } | { error: string }> {
  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (data["error"] === "authorization_pending") return { pending: true };
  if (data["error"]) return { error: String(data["error_description"] || data["error"]) };

  const access_token = String(data["access_token"] || "");
  const refresh_token = String(data["refresh_token"] || "");

  if (access_token && refresh_token) {
    persistToken("ONEDRIVE_REFRESH_TOKEN", refresh_token);
  }

  return { access_token, refresh_token };
}

// ─── Token Management ─────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<string> {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const refreshToken = process.env.ONEDRIVE_REFRESH_TOKEN;
  if (!clientId || !refreshToken) throw new Error("OneDrive not connected — use /api/onedrive/auth/start first");

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(String(data["error_description"] || data["error"] || "Token refresh failed"));

  if (data["refresh_token"]) persistToken("ONEDRIVE_REFRESH_TOKEN", String(data["refresh_token"]));
  return String(data["access_token"]);
}

// ─── User & Drive Info ────────────────────────────────────────────────────────

export async function getUserInfo(): Promise<{ displayName: string; mail: string; id: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_API}/me?$select=displayName,mail,id`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`User info error: ${res.status}`);
  return res.json() as Promise<{ displayName: string; mail: string; id: string }>;
}

export async function getDriveQuota(): Promise<DriveQuota> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_API}/me/drive?$select=quota`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Quota error: ${res.status}`);
  const data = await res.json() as { quota: DriveQuota };
  return data.quota;
}

// ─── File Operations ──────────────────────────────────────────────────────────

export async function listFiles(folderId?: string): Promise<DriveItem[]> {
  const token = await getAccessToken();
  const url = folderId
    ? `${GRAPH_API}/me/drive/items/${folderId}/children`
    : `${GRAPH_API}/me/drive/root/children`;
  const res = await fetch(
    `${url}?$select=id,name,size,file,folder,lastModifiedDateTime,webUrl,parentReference&$top=200&$orderby=lastModifiedDateTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`List files error: ${res.status} ${await res.text()}`);
  const data = await res.json() as { value: DriveItem[] };
  return data.value || [];
}

export async function searchFiles(query: string): Promise<DriveItem[]> {
  const token = await getAccessToken();
  const res = await fetch(
    `${GRAPH_API}/me/drive/root/search(q='${encodeURIComponent(query)}')?$select=id,name,size,file,folder,lastModifiedDateTime,webUrl&$top=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Search error: ${res.status}`);
  const data = await res.json() as { value: DriveItem[] };
  return data.value || [];
}

export async function downloadFileContent(itemId: string): Promise<Buffer> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_API}/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download error: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function uploadFile(
  name: string,
  content: Buffer,
  mimeType = "application/octet-stream",
  folderId?: string
): Promise<DriveItem> {
  const token = await getAccessToken();
  const url = folderId
    ? `${GRAPH_API}/me/drive/items/${folderId}:/${encodeURIComponent(name)}:/content`
    : `${GRAPH_API}/me/drive/root:/${encodeURIComponent(name)}:/content`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
    body: content,
  });
  if (!res.ok) throw new Error(`Upload error: ${res.status} ${await res.text()}`);
  return res.json() as Promise<DriveItem>;
}

export async function deleteFile(itemId: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_API}/me/drive/items/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204) throw new Error(`Delete error: ${res.status}`);
}

export async function createFolder(name: string, parentId?: string): Promise<DriveItem> {
  const token = await getAccessToken();
  const url = parentId
    ? `${GRAPH_API}/me/drive/items/${parentId}/children`
    : `${GRAPH_API}/me/drive/root/children`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
  });
  if (!res.ok) throw new Error(`Create folder error: ${res.status}`);
  return res.json() as Promise<DriveItem>;
}
