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

function readConfig(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}
function writeConfig(cfg: Record<string, unknown>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function saveRefreshToken(token: string): void {
  const cfg = readConfig();
  if (!cfg.secrets || typeof cfg.secrets !== "object") cfg.secrets = {};
  (cfg.secrets as Record<string, string>).SPOTIFY_REFRESH_TOKEN = token;
  writeConfig(cfg);
  process.env.SPOTIFY_REFRESH_TOKEN = token;
}

function savePinnedTrack(id: string, title: string, artist: string, thumb: string): void {
  const cfg = readConfig();
  if (!cfg.spotify || typeof cfg.spotify !== "object") cfg.spotify = {};
  (cfg.spotify as Record<string, string>).pinnedTrackId     = id;
  (cfg.spotify as Record<string, string>).pinnedTrackTitle  = title;
  (cfg.spotify as Record<string, string>).pinnedTrackArtist = artist;
  (cfg.spotify as Record<string, string>).pinnedTrackThumb  = thumb;
  writeConfig(cfg);
}

function getPinnedTrack(): { id: string; title: string; artist: string; thumb: string } | null {
  const cfg = readConfig();
  const sp = cfg.spotify as Record<string, string> | undefined;
  if (sp?.pinnedTrackId) {
    return {
      id:     sp.pinnedTrackId,
      title:  sp.pinnedTrackTitle  ?? "Unknown",
      artist: sp.pinnedTrackArtist ?? "Unknown",
      thumb:  sp.pinnedTrackThumb  ?? "",
    };
  }
  return null;
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

async function oembedTrack(trackId: string): Promise<{ title: string; thumb: string } | null> {
  try {
    const url = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const d = (await res.json()) as { title?: string; thumbnail_url?: string };
    return { title: d.title ?? "Unknown", thumb: d.thumbnail_url ?? "" };
  } catch { return null; }
}

// ─── SVG builder ─────────────────────────────────────────────────────────────
function buildSVG(opts: {
  title: string;
  artist: string;
  thumb: string;
  isPlaying: boolean;
  label: string;
  trackUrl: string;
}): string {
  const { title, artist, thumb, isPlaying, label, trackUrl } = opts;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  const barColor = isPlaying ? "#1DB954" : "#22c55e";

  const displayTitle  = esc(trunc(title, 32));
  const displayArtist = esc(trunc(artist, 40));

  const art = thumb
    ? `<image href="${thumb}" x="12" y="12" width="72" height="72" rx="4" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="12" y="12" width="72" height="72" rx="4" fill="#161b22"/>
       <text x="48" y="52" font-family="monospace" font-size="24" fill="#22c55e" text-anchor="middle">♪</text>`;

  const bars = isPlaying ? `
    <rect x="500" y="44" width="4" height="8"  fill="${barColor}" rx="1"><animate attributeName="height" values="4;22;4"  dur="0.7s" repeatCount="indefinite"/><animate attributeName="y" values="56;42;56" dur="0.7s" repeatCount="indefinite"/></rect>
    <rect x="508" y="38" width="4" height="18" fill="${barColor}" rx="1"><animate attributeName="height" values="18;6;18"  dur="0.5s" repeatCount="indefinite"/><animate attributeName="y" values="46;58;46" dur="0.5s" repeatCount="indefinite"/></rect>
    <rect x="516" y="42" width="4" height="12" fill="${barColor}" rx="1"><animate attributeName="height" values="8;20;8"   dur="0.9s" repeatCount="indefinite"/><animate attributeName="y" values="50;40;50" dur="0.9s" repeatCount="indefinite"/></rect>
    <rect x="524" y="46" width="4" height="10" fill="${barColor}" rx="1"><animate attributeName="height" values="10;6;10"  dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="50;54;50" dur="0.6s" repeatCount="indefinite"/></rect>
    <rect x="532" y="40" width="4" height="16" fill="${barColor}" rx="1"><animate attributeName="height" values="16;10;16" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="44;50;44" dur="0.8s" repeatCount="indefinite"/></rect>
  ` : `
    <rect x="500" y="50" width="4" height="8"  fill="#333" rx="1"/>
    <rect x="508" y="46" width="4" height="12" fill="#333" rx="1"/>
    <rect x="516" y="48" width="4" height="10" fill="#333" rx="1"/>
    <rect x="524" y="50" width="4" height="8"  fill="#333" rx="1"/>
    <rect x="532" y="47" width="4" height="11" fill="#333" rx="1"/>
  `;

  const pixelCorners = `
    <rect x="0"   y="0"  width="8" height="2" fill="${barColor}"/>
    <rect x="0"   y="0"  width="2" height="8" fill="${barColor}"/>
    <rect x="550" y="0"  width="8" height="2" fill="${barColor}"/>
    <rect x="556" y="0"  width="2" height="8" fill="${barColor}"/>
    <rect x="0"   y="94" width="8" height="2" fill="${barColor}"/>
    <rect x="0"   y="88" width="2" height="8" fill="${barColor}"/>
    <rect x="550" y="94" width="8" height="2" fill="${barColor}"/>
    <rect x="556" y="88" width="2" height="8" fill="${barColor}"/>
  `;

  const scanline = isPlaying ? `
    <rect width="558" height="1" fill="#ffffff" opacity="0.04">
      <animateTransform attributeName="transform" type="translate" values="0,0;0,96" dur="4s" repeatCount="indefinite"/>
    </rect>
  ` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="558" height="96" viewBox="0 0 558 96">
  <rect width="558" height="96" fill="#0d1117" rx="6"/>
  <rect width="558" height="96" fill="none" stroke="#21262d" stroke-width="1" rx="6"/>
  <rect x="0" y="0" width="3" height="96" fill="${barColor}" rx="2"/>
  ${pixelCorners}
  ${scanline}
  ${art}
  <rect x="92" y="18" width="380" height="1" fill="#161b22"/>
  <text x="98" y="14" font-family="'Courier New',Courier,monospace" font-size="8" fill="${barColor}" font-weight="bold" letter-spacing="2">${esc(label)}</text>
  <text x="98" y="46" font-family="'Courier New',Courier,monospace" font-size="16" fill="#e6edf3" font-weight="bold">${displayTitle}</text>
  <text x="98" y="64" font-family="'Courier New',Courier,monospace" font-size="11" fill="#8b949e">${displayArtist}</text>
  <text x="98" y="80" font-family="'Courier New',Courier,monospace" font-size="8"  fill="#22c55e" opacity="0.6" letter-spacing="1">open.spotify.com</text>
  ${bars}
  <text x="554" y="90" font-family="'Courier New',Courier,monospace" font-size="7" fill="#1DB954" text-anchor="end" letter-spacing="1">SPOTIFY</text>
</svg>`;
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
  <p style="font-size:28px;margin:0;color:#1DB954">SPOTIFY CONNECTED</p>
  <p style="color:#8b949e;margin:0">Refresh token saved. Widget is live.</p>
  <p style="margin:4px 0 0"><a href="/api/spotify/now-playing" style="color:#58a6ff">/api/spotify/now-playing</a></p>
</body>
</html>`);
});

// ─── Pin a track ──────────────────────────────────────────────────────────────
router.get("/spotify/pin/:trackId", async (req: Request, res: Response) => {
  const trackId = req.params["trackId"];
  const oembed = await oembedTrack(trackId);
  if (!oembed) {
    res.status(404).json({ error: "Could not fetch track info" });
    return;
  }
  const titleParts = oembed.title.split(" · ");
  const title  = titleParts[0] ?? oembed.title;
  const artist = titleParts[1] ?? "Spotify";
  savePinnedTrack(trackId, title, artist, oembed.thumb);
  res.json({
    ok: true,
    message: "Track pinned as featured track",
    track: { id: trackId, title, artist, thumb: oembed.thumb },
  });
});

// ─── Now Playing SVG widget ───────────────────────────────────────────────────
router.get("/spotify/now-playing", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");

  const accessToken = await getAccessToken();
  const pinned      = getPinnedTrack();

  let title    = pinned?.title  ?? "NOT PLAYING";
  let artist   = pinned?.artist ?? "—";
  let thumb    = pinned?.thumb  ?? "";
  let isPlaying = false;
  let label    = "PINNED TRACK";
  let trackUrl = pinned ? `https://open.spotify.com/track/${pinned.id}` : "https://open.spotify.com";

  if (accessToken) {
    try {
      const npRes = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (npRes.status === 200) {
        const data = (await npRes.json()) as {
          is_playing: boolean;
          item?: { id: string; name: string; artists: { name: string }[]; album: { images: { url: string }[] } };
        };
        isPlaying = data.is_playing;
        if (data.item) {
          title    = data.item.name;
          artist   = data.item.artists.map((a) => a.name).join(", ");
          thumb    = data.item.album.images[1]?.url ?? data.item.album.images[0]?.url ?? thumb;
          trackUrl = `https://open.spotify.com/track/${data.item.id}`;
          label    = isPlaying ? "NOW PLAYING" : "RECENTLY PLAYED";
        }
      } else if (npRes.status !== 204) {
        const recentRes = await fetch(
          "https://api.spotify.com/v1/me/player/recently-played?limit=1",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (recentRes.status === 200) {
          const recent = (await recentRes.json()) as {
            items: { track: { id: string; name: string; artists: { name: string }[]; album: { images: { url: string }[] } } }[];
          };
          if (recent.items.length > 0) {
            const t = recent.items[0].track;
            title    = t.name;
            artist   = t.artists.map((a) => a.name).join(", ");
            thumb    = t.album.images[1]?.url ?? t.album.images[0]?.url ?? thumb;
            trackUrl = `https://open.spotify.com/track/${t.id}`;
            label    = "RECENTLY PLAYED";
          }
        }
      }
    } catch { /* fallback to pinned */ }
  }

  res.send(buildSVG({ title, artist, thumb, isPlaying, label, trackUrl }));
});

export default router;
