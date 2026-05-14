// AreaLead server v0.2 — Express + email/password auth + plan/quota + AI polish + feedback
// (Stripe撤回 → 課金は mailto: でお問い合わせ式)

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchTargets } from "./lib/places.js";
import { enrichRows } from "./lib/scraper.js";
import { rowsToCsv } from "./lib/csv.js";
import {
  ensureUser, getPlanState, consumeRows, applyReferralCode,
  getReferralShareInfo, getUpgradeMailto, PLANS, UPGRADE_EMAIL,
} from "./lib/plan.js";
import { enrichWithClaude } from "./lib/claude.js";
import {
  registerAccount, loginAccount, createSession, getSession, destroySession,
} from "./lib/auth.js";
import { appendArrayJson, updateUser } from "./lib/storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const SESSION_COOKIE = "al_sid";
const COOKIE_OPTS = { httpOnly: true, sameSite: "lax", maxAge: 90 * 24 * 60 * 60 * 1000 };

const app = express();
app.use(cors({ credentials: true }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// ─── Session middleware ────────────────────────────────
app.use((req, _res, next) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  const sess = getSession(sid);
  if (sess) {
    req.userId = sess.user_id;
    req.email = sess.email;
    ensureUser(sess.user_id);
  }
  next();
});

function requireLogin(req, res, next) {
  if (!req.userId) return res.status(401).json({ ok: false, error: "ログインが必要です", needLogin: true });
  next();
}

// ─── Static files ─────────────────────────────────────
app.use(express.static(PUBLIC_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "0.2.0" }));

// ─── Auth endpoints ────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  const r = await registerAccount({ email, password });
  if (!r.ok) return res.status(400).json(r);
  const { session_id } = createSession({ user_id: r.user_id, email: r.email });
  res.cookie(SESSION_COOKIE, session_id, COOKIE_OPTS);
  // Initialize user + persist email
  ensureUser(r.user_id);
  updateUser(r.user_id, { subscriber_email: r.email });
  res.json({ ok: true, data: { email: r.email } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const r = await loginAccount({ email, password });
  if (!r.ok) return res.status(401).json(r);
  const { session_id } = createSession({ user_id: r.user_id, email: r.email });
  res.cookie(SESSION_COOKIE, session_id, COOKIE_OPTS);
  ensureUser(r.user_id);
  updateUser(r.user_id, { subscriber_email: r.email });
  res.json({ ok: true, data: { email: r.email } });
});

app.post("/api/auth/logout", (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  destroySession(sid);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.userId) return res.json({ ok: true, data: null });
  res.json({ ok: true, data: { email: req.email, user_id: req.userId } });
});

// ─── Plan endpoints (require login) ────────────────────
app.get("/api/plan/state", requireLogin, (req, res) => {
  res.json({ ok: true, data: getPlanState(req.userId) });
});

app.get("/api/plan/pricing", (_req, res) => res.json({ ok: true, data: PLANS }));

app.post("/api/plan/upgrade-link", requireLogin, (req, res) => {
  const planType = (req.body?.plan || "starter").toLowerCase();
  const url = getUpgradeMailto(planType, req.userId);
  res.json({ ok: true, data: { url, contact_email: UPGRADE_EMAIL } });
});

// 管理者がアップグレード実行（手動運用：mailto受領後、管理画面 or 直接 DB編集）
app.post("/api/plan/admin/grant", (req, res) => {
  const adminKey = req.header("x-admin-key");
  if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "admin key required" });
  }
  const { email, plan = "starter" } = req.body || {};
  // Find user_id by email
  const accounts = JSON.parse(require("node:fs").readFileSync(path.join(__dirname, "..", ".data", "accounts.json"), "utf-8") || "{}");
  const a = accounts[String(email || "").toLowerCase()];
  if (!a) return res.status(404).json({ ok: false, error: "account not found" });
  updateUser(a.user_id, { plan, plan_source: "manual", plan_started_ts: Date.now() });
  res.json({ ok: true, data: getPlanState(a.user_id) });
});

// ─── Referral ─────────────────────────────────────────
app.get("/api/referral/info", requireLogin, (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  res.json({ ok: true, data: getReferralShareInfo(req.userId, host) });
});

app.post("/api/referral/apply", requireLogin, (req, res) => {
  const result = applyReferralCode(req.userId, req.body?.code);
  res.json({ ok: result.ok, data: result, planState: getPlanState(req.userId) });
});

// ─── Feedback ─────────────────────────────────────────
app.post("/api/feedback", (req, res) => {
  const { message = "", email = "", category = "general" } = req.body || {};
  if (!message.trim()) return res.status(400).json({ ok: false, error: "message required" });
  appendArrayJson("feedback", {
    ts: Date.now(),
    user_id: req.userId || null,
    user_email: req.email || null,
    submitter_email: email.slice(0, 200),
    category,
    message: message.slice(0, 4000),
  });
  res.json({ ok: true });
});

// AI添削 (polishText) は v0.2 で撤去 — Claude API は enrichWithClaude (優先度判定) で使用

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

// ─── Main: テナント候補リスト生成 (BYOK + 多キーワード×エリア + Claude判定) ───
app.post("/api/generate", requireLogin, async (req, res) => {
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

    // Build queries: each keyword × (global + each area)
    const queries = [];
    for (const kw of enabledKeywords) {
      queries.push(kw);
      for (const area of areas) queries.push(`${area} ${kw}`);
    }

    // Phase 1: Places search
    let places = await searchTargets({
      queries,
      languageCode: language,
      regionCode: region,
      apiKey,
      companyKeywords: COMPANY_NAME_KEYWORDS,
    });

    const MAX_TO_ENRICH = 60;
    let placesForEnrich = places.slice(0, MAX_TO_ENRICH);

    // Phase 2: Claude enrichment (optional)
    let enriched = placesForEnrich;
    let usedClaude = false;
    if (options.enrichWithAi !== false && apiKeys.anthropic && placesForEnrich.length > 0) {
      try {
        enriched = await enrichWithClaude({
          apiKey: apiKeys.anthropic,
          property: { name: property.name, address: property.address, areas, hook: property.hook },
          rows: placesForEnrich,
          batchSize: 25,
        });
        usedClaude = true;
      } catch (e) {
        console.warn("[Claude] enrich failed:", e.message);
      }
    }

    // Phase 3: website scraping
    if (options.scrape !== false) {
      enriched = await enrichRows(enriched, { concurrency: 6 });
    }

    consumeRows(req.userId, enriched.length);

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
      rows: enriched,
      csv_base64: csvBase64,
    });
  } catch (e) {
    console.error("[AreaLead] generate error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AreaLead v0.2] http://localhost:${PORT}`);
});
