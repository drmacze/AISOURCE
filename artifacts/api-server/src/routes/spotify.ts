import { Router, type Request, type Response } from "express";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

const router = Router();

const CLIENT_ID     = () => process.env.SPOTIFY_CLIENT_ID     ?? "";
const CLIENT_SECRET = () => process.env.SPOTIFY_CLIENT_SECRET ?? "";
const REDIRECT_URI  = () =>
  process.env.SPOTIFY_REDIRECT_URI ||
  `https://${process.env.REPLIT_DEV_DOMAIN}/api/spotify/callback`;

const CONFIG_PATH = join(
  process.env.REPL_HOME || process.env.HOME || "/home/runner/workspace",
  ".dlavie-config.json",
);

function saveRefreshToken(token: string): void {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { /* new file */ }
  if (!cfg.secrets || typeof cfg.secrets !== "object") cfg.secrets = {};
  (cfg.secrets as Record<string, string>).SPOTIFY_REFRESH_TOKEN = token;
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  process.env.SPOTIFY_REFRESH_TOKEN = token;
}

async function getAccessToken(): Promise<string | null> {
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!refreshToken) return null;
  try {
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch { return null; }
}

// ─── Login ────────────────────────────────────────────────────────────────────
router.get("/spotify/login", (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id:     CLIENT_ID(),
    scope:         "user-read-currently-playing user-read-recently-played",
    redirect_uri:  REDIRECT_URI(),
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// ─── OAuth callback ───────────────────────────────────────────────────────────
router.get("/spotify/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.status(400).send("Missing code"); return; }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: REDIRECT_URI(),
    }),
  });

  const tokens = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!tokens.refresh_token) {
    res.status(400).json({ error: "No refresh token", detail: tokens });
    return;
  }

  saveRefreshToken(tokens.refresh_token);

  res.send(`<!DOCTYPE html>
<html>
<head><title>Spotify Connected</title></head>
<body style="background:#0d1117;color:#e6edf3;font-family:'Courier New',monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;text-align:center">
  <p style="font-size:28px;margin:0">✓ SPOTIFY CONNECTED</p>
  <p style="color:#8b949e;margin:0">Refresh token saved. You can close this tab.</p>
  <p style="color:#8b949e;margin:4px 0 0">Widget live at:
    <a href="/api/spotify/now-playing" style="color:#58a6ff">/api/spotify/now-playing</a>
  </p>
</body>
</html>`);
});

// ─── Now Playing SVG widget ───────────────────────────────────────────────────
router.get("/spotify/now-playing", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");

  const accessToken = await getAccessToken();

  let title    = "NOT PLAYING";
  let artist   = "—";
  let isPlaying = false;
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;

  if (accessToken) {
    try {
      const npRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (npRes.status === 200) {
        const data = (await npRes.json()) as {
          is_playing: boolean;
          item?: { name: string; artists: { name: string }[] };
        };
        isPlaying = data.is_playing;
        title  = data.item?.name ?? "Unknown";
        artist = data.item?.artists.map((a) => a.name).join(", ") ?? "Unknown";
      } else {
        const recentRes = await fetch(
          "https://api.spotify.com/v1/me/player/recently-played?limit=1",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (recentRes.status === 200) {
          const recent = (await recentRes.json()) as {
            items: { track: { name: string; artists: { name: string }[] } }[];
          };
          if (recent.items.length > 0) {
            title  = recent.items[0].track.name;
            artist = recent.items[0].track.artists.map((a) => a.name).join(", ");
          }
        }
      }
    } catch { /* fallback to defaults */ }
  }

  const displayTitle  = truncate(title, 30);
  const displayArtist = truncate(artist, 36);
  const statusLabel   = !accessToken
    ? "⚡ NOT CONFIGURED"
    : isPlaying
      ? "▶  NOW PLAYING"
      : "⏸  RECENTLY PLAYED";
  const barColor = isPlaying ? "#1DB954" : "#555";

  const playBars = isPlaying ? `
    <rect x="450" y="50" width="3" height="12" fill="#1DB954" rx="1">
      <animate attributeName="height" values="4;12;4" dur="0.8s" repeatCount="indefinite"/>
      <animate attributeName="y" values="58;50;58" dur="0.8s" repeatCount="indefinite"/>
    </rect>
    <rect x="456" y="44" width="3" height="18" fill="#1DB954" rx="1">
      <animate attributeName="height" values="18;6;18" dur="0.6s" repeatCount="indefinite"/>
      <animate attributeName="y" values="44;56;44" dur="0.6s" repeatCount="indefinite"/>
    </rect>
    <rect x="462" y="48" width="3" height="14" fill="#1DB954" rx="1">
      <animate attributeName="height" values="8;14;8" dur="1s" repeatCount="indefinite"/>
      <animate attributeName="y" values="54;48;54" dur="1s" repeatCount="indefinite"/>
    </rect>` : "";

  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="80" viewBox="0 0 480 80">
  <rect width="480" height="80" rx="6" fill="#0d1117" stroke="#21262d" stroke-width="1"/>
  <rect x="0" y="0" width="3" height="80" rx="2" fill="${barColor}"/>
  <text x="16" y="19" font-family="'Courier New',monospace" font-size="9" fill="${barColor}" font-weight="bold" letter-spacing="1">${statusLabel}</text>
  <text x="16" y="44" font-family="'Courier New',monospace" font-size="15" fill="#e6edf3" font-weight="bold">${displayTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
  <text x="16" y="64" font-family="'Courier New',monospace" font-size="11" fill="#8b949e">${displayArtist.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>
  <text x="474" y="72" font-family="'Courier New',monospace" font-size="8" fill="#1DB954" text-anchor="end" letter-spacing="1">SPOTIFY</text>
  ${playBars}
</svg>`);
});

export default router;
