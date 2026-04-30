// AreaLead server — Express API + static frontend
// MVP scope:
//   POST /api/search   { industry, area, keywords, language, region, max }
//                       → returns enriched rows + CSV (base64)
//   GET  /api/health   → ok

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textSearch, normalizePlace } from "./lib/places.js";
import { enrichRows } from "./lib/scraper.js";
import { rowsToCsv } from "./lib/csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: !!process.env.GOOGLE_MAPS_API_KEY });
});

app.post("/api/search", async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "GOOGLE_MAPS_API_KEY not set on server" });
  }
  try {
    const {
      industry = "",
      area = "",
      keywords = "",
      language = "ja",
      region = "JP",
      max = 20,
      enrich = true,
    } = req.body || {};

    if (!industry && !keywords) {
      return res.status(400).json({ ok: false, error: "industry or keywords required" });
    }
    if (!area) {
      return res.status(400).json({ ok: false, error: "area required" });
    }

    // Compose query
    const queryParts = [industry, keywords, area].filter(Boolean);
    const query = queryParts.join(" ").trim();

    const places = await textSearch({
      query,
      languageCode: language,
      regionCode: region,
      maxResults: Math.min(Number(max) || 20, 20),
      apiKey,
    });
    const rows = places.map(normalizePlace);

    let enrichedRows = rows;
    if (enrich) {
      enrichedRows = await enrichRows(rows, { concurrency: 4 });
    }

    const columns = [
      "name", "address", "phone", "website", "emails", "contact_url",
      "has_inquiry_form", "meta_description", "rating", "review_count",
      "types", "business_status", "maps_url", "lat", "lng", "place_id",
      "enrichment_status",
    ];
    const csv = rowsToCsv(enrichedRows, columns);
    const csvBase64 = Buffer.from(csv, "utf-8").toString("base64");

    res.json({
      ok: true,
      query,
      count: enrichedRows.length,
      rows: enrichedRows,
      csv_base64: csvBase64,
    });
  } catch (e) {
    console.error("[AreaLead] search error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AreaLead] listening on http://localhost:${PORT}`);
});
