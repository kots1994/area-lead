// AreaLead server v0.2 (BYOK / stateless / Vercel-friendly)
// 認証なし: BYOK が事実上のゲート（自分のAPIキーがない人は使えない）

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchTargets } from "./lib/places.js";
import { enrichRows } from "./lib/scraper.js";
import { rowsToCsv } from "./lib/csv.js";
import { enrichWithClaude } from "./lib/claude.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.use(cors({ credentials: true }));
app.use(express.json({ limit: "100kb" }));
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
    if (!property.name) return res.status(400).json({ ok: false, error: "物件名が必要です" });
    if (!Array.isArray(property.areas) || property.areas.length === 0) {
      return res.status(400).json({ ok: false, error: "対象エリアを1つ以上入力してください" });
    }
    const language = options.language || "ja";
    const region = options.region || "JP";
    const enabledKeywords = (keywords && keywords.length > 0) ? keywords : DEFAULT_KEYWORDS;
    const areas = property.areas;

    const queries = [];
    for (const kw of enabledKeywords) {
      queries.push(kw);
      for (const area of areas) queries.push(`${area} ${kw}`);
    }

    let places = await searchTargets({
      queries, languageCode: language, regionCode: region,
      apiKey, companyKeywords: COMPANY_NAME_KEYWORDS,
    });

    const MAX_TO_ENRICH = 60;
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

    const columns = [
      "priority", "revenue_rank", "category",
      "name", "address", "phone", "website",
      "emails", "contact_url", "has_inquiry_form",
      "reason", "estimated_department",
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
      },
      claude_usage: claudeUsage,
      rows: enriched,
      csv_base64: csvBase64,
    });
  } catch (e) {
    console.error("[AreaLead] generate error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
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
