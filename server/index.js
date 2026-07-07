// AreaLead server v0.2 (BYOK / stateless / Vercel-friendly)
// 認証なし: BYOK が事実上のゲート（自分のAPIキーがない人は使えない）

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchTargets } from "./lib/places.js";
import { enrichRows } from "./lib/scraper.js";
import { rowsToCsv } from "./lib/csv.js";
import { enrichWithClaude } from "./lib/claude.js";
import { geocodeAddress } from "./lib/geocode.js";
import { filterByDrivetime } from "./lib/drivetime.js";
import { resolvePin } from "./lib/pin.js";
import { scanRoofs } from "./lib/roofscan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const PASSWORD = process.env.SITE_PASSWORD || "shun12345";
const COOKIE_SECRET = process.env.COOKIE_SECRET || "arealead-secret-v1";
const COOKIE_NAME = "al_auth";

function makeToken(pw) {
  return crypto.createHmac("sha256", COOKIE_SECRET).update(pw).digest("hex");
}
const VALID_TOKEN = makeToken(PASSWORD);

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token === VALID_TOKEN) return next();
  // API requests → 401
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  // Static assets → pass through (css/js needed for login page)
  if (/\.(css|js|png|ico|woff2?)$/.test(req.path)) return next();
  // Login page itself → pass through
  if (req.path === "/login" || req.path === "/login.html") return next();
  // Everything else → redirect to login
  res.redirect("/login.html");
}

const app = express();
app.use(cors({ credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "100kb" }));

// Login endpoint (before auth middleware)
app.post("/api/login", (req, res) => {
  const { password } = req.body || {};
  if (password === PASSWORD) {
    res.cookie(COOKIE_NAME, VALID_TOKEN, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false });
});

app.use(requireAuth);
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "0.2.0" }));

// 倉庫テナント向けデフォルトキーワード
const DEFAULT_KEYWORDS = [
  "運輸", "物流", "倉庫", "EC配送", "越境EC", "3PL", "ロジスティクス", "運送",
];
const COMPANY_NAME_KEYWORDS = [
  "物流", "ロジスティクス", "運輸", "運送", "倉庫", "3PL",
  "logistics", "transport", "warehouse", "delivery",
  "配送", "通運", "急便", "エクスプレス", "フルフィルメント",
  "EC", "越境", "貿易", "freight", "cargo",
];

// ─── Main: テナント候補リスト生成 ───
app.post("/api/generate", async (req, res) => {
  const { apiKeys = {}, property = {}, keywords, options = {} } = req.body || {};
  const apiKey = apiKeys.google_maps || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(400).json({
    ok: false,
    error: "Google Maps API キーが必要です。右上「⚙️ API設定」から登録してください。",
    needApiKey: true,
  });
  try {
    if (!property.name && !property.address && !property.pin) {
      return res.status(400).json({ ok: false, error: "物件名・住所・Googleマップのピンのいずれかが必要です" });
    }
    const language = options.language || "ja";
    const region = options.region || "JP";
    const searchMode = options.searchMode || "area"; // "area" | "radius" | "drivetime"
    // 対象エリアは「エリア指定」モードでのみ必須（半径/車/業種別は地理を別途指定するため不要）
    if (searchMode === "area" && options.industryMode !== true &&
        (!Array.isArray(property.areas) || property.areas.length === 0)) {
      return res.status(400).json({ ok: false, error: "対象エリアを1つ以上入力してください" });
    }
    const enabledKeywords = (keywords && keywords.length > 0) ? keywords : DEFAULT_KEYWORDS;
    const areas = property.areas || [];

    // Resolve lat/lng for radius/drivetime modes
    let propertyLatLng = null;
    let drivetimeUsage = null;
    if (searchMode === "radius" || searchMode === "drivetime") {
      // 基点の優先順位: ①Googleマップのピン(URL/座標) → ②住所 → ③物件名でジオコード
      if (property.pin) {
        propertyLatLng = await resolvePin(property.pin);
        if (!propertyLatLng) {
          return res.status(400).json({ ok: false, error: "ピンを解析できませんでした。Googleマップの共有リンク、または「緯度,経度」（例: 35.4310,139.3823）を貼り付けてください。" });
        }
      } else {
        const origin = property.address || property.name;
        if (!origin) {
          return res.status(400).json({ ok: false, error: "半径・車時間モードには住所・物件名・ピンのいずれかが必要です" });
        }
        propertyLatLng = await geocodeAddress({ address: origin, apiKey });
      }
    }

    // Build queries
    const queries = [];
    const industryMode = options.industryMode === true;
    if (industryMode) {
      // 業種別検索: areas が指定されていればエリア×キーワード、空なら全国検索（キーワードのみ）
      const realAreas = areas.filter((a) => a !== "全国");
      for (const kw of enabledKeywords) {
        queries.push(kw);
        for (const area of realAreas) queries.push(`${area} ${kw}`);
      }
    } else if (searchMode === "area") {
      for (const kw of enabledKeywords) {
        queries.push(kw);
        for (const area of areas) queries.push(`${area} ${kw}`);
      }
    } else {
      // radius / drivetime: keyword-only queries (circle restriction handles geography)
      for (const kw of enabledKeywords) queries.push(kw);
    }

    // Circle for radius / drivetime modes
    const drivetimeMinutes = options.drivetimeMinutes || 30;
    // drivetime モード: 一般道40km/h想定で分×0.67km + 余裕でカバーする
    const autoRadiusForDrivetime = Math.min(Math.max(drivetimeMinutes * 0.8, 15), 80);
    const radiusKm = searchMode === "drivetime"
      ? autoRadiusForDrivetime
      : (options.radiusKm || 20);
    const circle = propertyLatLng
      ? { lat: propertyLatLng.lat, lng: propertyLatLng.lng, radiusMeters: radiusKm * 1000 }
      : null;

    // 業種別検索モードでは物流名フィルタを外す（建材・福祉等は引っかからない為）
    let places = await searchTargets({
      queries, languageCode: language, regionCode: region,
      apiKey,
      companyKeywords: industryMode ? null : COMPANY_NAME_KEYWORDS,
      circle,
    });
    const mapsUsage = places._mapsUsage || null;
    delete places._mapsUsage;

    // 大手除外フィルタ（業種別検索のエマージング指定）
    const excludeCompanies = Array.isArray(options.excludeCompanies) ? options.excludeCompanies : [];
    if (excludeCompanies.length > 0) {
      const excludeLower = excludeCompanies.map((s) => s.toLowerCase());
      places = places.filter((p) => {
        const nl = (p.name || "").toLowerCase();
        return !excludeLower.some((ex) => nl.includes(ex.toLowerCase()));
      });
    }

    const MAX_TO_ENRICH = Math.min(Math.max(parseInt(options.maxResults, 10) || 150, 1), 300);
    const truncated = places.length > MAX_TO_ENRICH;
    let placesForEnrich = places.slice(0, MAX_TO_ENRICH);

    let enriched = placesForEnrich;
    let usedClaude = false;
    let claudeUsage = null;
    if (options.enrichWithAi !== false && apiKeys.anthropic && placesForEnrich.length > 0) {
      try {
        const result = await enrichWithClaude({
          apiKey: apiKeys.anthropic,
          property: { name: property.name, address: property.address, areas, hook: property.hook },
          rows: placesForEnrich,
          batchSize: 25,
        });
        enriched = result.rows;
        claudeUsage = result.claudeUsage;
        usedClaude = true;
      } catch (e) {
        console.warn("[Claude] enrich failed:", e.message);
      }
    }
    if (options.scrape !== false) {
      enriched = await enrichRows(enriched, { concurrency: 6 });
    }

    // Driving time filter
    if (searchMode === "drivetime" && propertyLatLng && enriched.length > 0) {
      try {
        const dtResult = await filterByDrivetime({
          rows: enriched,
          origin: propertyLatLng,
          maxMinutes: drivetimeMinutes,
          apiKey,
        });
        enriched = dtResult.rows;
        drivetimeUsage = {
          request_count: dtResult.requestCount,
          cost_usd: dtResult.costUsd,
          cost_jpy: dtResult.costJpy,
          max_minutes: drivetimeMinutes,
        };
      } catch (e) {
        console.warn("[Drivetime] filter failed:", e.message);
      }
    }

    const columns = [
      "priority", "revenue_rank", "category",
      "name", "address", "phone", "website",
      "emails", "contact_url", "has_inquiry_form",
      "reason", "estimated_department",
      "drive_minutes", "drive_distance_km",
      "rating", "review_count",
      "chinese_or_ec_emerging",
      "maps_url", "types", "business_status",
      "meta_description", "lat", "lng", "place_id",
      "enrichment_status",
    ];
    const csv = rowsToCsv(enriched, columns);
    const csvBase64 = Buffer.from(csv, "utf-8").toString("base64");

    res.json({
      ok: true,
      property: property.name,
      counts: {
        found: places.length,
        enriched_with_claude: usedClaude ? enriched.length : 0,
        returned: enriched.length,
        truncated,
        cap: MAX_TO_ENRICH,
      },
      maps_usage: mapsUsage,
      claude_usage: claudeUsage,
      drivetime_usage: drivetimeUsage,
      rows: enriched,
      csv_base64: csvBase64,
    });
  } catch (e) {
    console.error("[AreaLead] generate error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// ─── 航空写真から倉庫っぽい大屋根を検出（Claude Vision）───
app.post("/api/roofscan", async (req, res) => {
  const { apiKeys = {}, center = {}, zoom = 17, minAreaSqm = 1000 } = req.body || {};
  const apiKey = apiKeys.google_maps || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(400).json({ ok: false, error: "Google Maps API キーが必要です", needApiKey: true });
  if (!apiKeys.anthropic) return res.status(400).json({ ok: false, error: "屋根検出には Anthropic Claude API キーが必要です（API設定から登録）", needApiKey: true });
  try {
    // 中心の解決: ピン(URL/座標) → 住所 でジオコード
    let latLng = null;
    if (center.pin) {
      latLng = await resolvePin(center.pin);
      if (!latLng) return res.status(400).json({ ok: false, error: "ピンを解析できませんでした（共有リンク or 緯度,経度）" });
    } else if (center.address) {
      latLng = await geocodeAddress({ address: center.address, apiKey });
    } else if (typeof center.lat === "number" && typeof center.lng === "number") {
      latLng = { lat: center.lat, lng: center.lng };
    } else {
      return res.status(400).json({ ok: false, error: "中心地点（ピン・住所・座標のいずれか）が必要です" });
    }
    const z = Math.min(Math.max(parseInt(zoom, 10) || 17, 14), 20);
    const minA = Math.max(parseInt(minAreaSqm, 10) || 0, 0);
    const result = await scanRoofs({
      apiKey, anthropicKey: apiKeys.anthropic,
      lat: latLng.lat, lng: latLng.lng, zoom: z, minAreaSqm: minA,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "roofscan failed" });
  }
});

// ─── Feedback (no auth, no storage on Vercel — just log) ───
app.post("/api/feedback", (req, res) => {
  const { message = "", email = "", category = "general" } = req.body || {};
  if (!message.trim()) return res.status(400).json({ ok: false, error: "message required" });
  console.log("[Feedback]", { ts: Date.now(), category, email: email.slice(0, 200), message: message.slice(0, 4000) });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AreaLead v0.2] http://localhost:${PORT}`);
});

export default app;
