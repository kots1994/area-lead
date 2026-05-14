// AreaLead server v0.2 — Express + email/password auth + plan/quota + AI polish + feedback
// (Stripe撤回 → 課金は mailto: でお問い合わせ式)

import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textSearch, normalizePlace } from "./lib/places.js";
import { enrichRows } from "./lib/scraper.js";
import { rowsToCsv } from "./lib/csv.js";
import {
  ensureUser, getPlanState, consumeRows, applyReferralCode,
  getReferralShareInfo, getUpgradeMailto, PLANS, UPGRADE_EMAIL,
} from "./lib/plan.js";
import { polishText } from "./lib/claude.js";
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

// ─── AI polish ────────────────────────────────────────
app.post("/api/ai/polish", requireLogin, async (req, res) => {
  const { text = "", style = "polite", purpose = "reason" } = req.body || {};
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "AI add-on is not configured" });
  if (!text.trim()) return res.status(400).json({ ok: false, error: "text required" });
  const plan = getPlanState(req.userId);
  if (plan.plan === "free") {
    const today = new Date().toISOString().split("T")[0];
    global.__aiQuota = global.__aiQuota || {};
    const k = `${req.userId}_${today}`;
    global.__aiQuota[k] = (global.__aiQuota[k] || 0) + 1;
    if (global.__aiQuota[k] > 20) {
      return res.status(429).json({ ok: false, error: "1日のAI添削上限 (20回) に達しました。Starter以上にアップグレードで無制限。" });
    }
  }
  try {
    const out = await polishText({ apiKey: key, text, style, purpose });
    res.json({ ok: true, data: { polished: out } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Main search (require login + quota enforcement) ───
app.post("/api/search", requireLogin, async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: "GOOGLE_MAPS_API_KEY not set on server" });

  try {
    const { industry = "", area = "", keywords = "", language = "ja", region = "JP", max = 20, enrich = true } = req.body || {};
    if (!industry && !keywords) return res.status(400).json({ ok: false, error: "industry or keywords required" });
    if (!area) return res.status(400).json({ ok: false, error: "area required" });

    const planState = getPlanState(req.userId);
    if (planState.blocked) {
      return res.status(402).json({
        ok: false,
        error: "今月の無料枠を使い切りました。プランをアップグレードしてください。",
        planState,
      });
    }

    const query = [industry, keywords, area].filter(Boolean).join(" ").trim();
    const places = await textSearch({
      query, languageCode: language, regionCode: region,
      maxResults: Math.min(Number(max) || 20, 20),
      apiKey,
    });
    const rows = places.map(normalizePlace);

    let enrichedRows = rows;
    if (enrich) enrichedRows = await enrichRows(rows, { concurrency: 4 });

    consumeRows(req.userId, enrichedRows.length);

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
      planState: getPlanState(req.userId),
    });
  } catch (e) {
    console.error("[AreaLead] search error", e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[AreaLead v0.2] http://localhost:${PORT}`);
});
