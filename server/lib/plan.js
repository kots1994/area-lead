// Plan / quota / referral logic for AreaLead

import { getUser, updateUser, readJson, writeJson } from "./storage.js";

// AreaLead pricing (different from sakutto/pitchfill — usage based)
export const PLANS = {
  free: { name: "Free", monthly_quota: 50, price_jpy: 0 },
  starter: { name: "Starter", monthly_quota: 1000, price_jpy: 2980 },
  pro: { name: "Pro", monthly_quota: 10000, price_jpy: 9800 },
  enterprise: { name: "Enterprise", monthly_quota: -1, price_jpy: null },
};

// Upgrade contact email (no Stripe — manual upgrade for MVP)
export const UPGRADE_EMAIL = "makotoejima@gmail.com";
export function getUpgradeMailto(planType, userId) {
  const subject = `[AreaLead] ${planType.toUpperCase()}プランアップグレード希望`;
  const body = `AreaLeadのアップグレードを希望します。\n\n` +
    `希望プラン: ${planType}\n` +
    `ユーザーID: ${userId || "（未取得）"}\n` +
    `ご請求先メールアドレス: \n` +
    `ご請求先社名 / 個人名: \n\n` +
    `折り返しご請求書をお送りします。よろしくお願いいたします。`;
  return `mailto:${UPGRADE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const REFERRAL_REWARD_INVITER_MONTHS = 1;
const REFERRAL_REWARD_INVITEE_BONUS_ROWS = 100;

const AMBASSADOR_PREFIX = "AMB-";
const AMBASSADOR_PRO_DAYS = 180;

function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[buf[i] % chars.length];
  return s;
}

function defaultUser() {
  return {
    user_id: null,
    plan: "free",
    plan_source: null,           // "stripe" | "ambassador" | "testing"
    plan_started_ts: Date.now(),
    plan_expires_ts: null,       // for ambassador / cancelled subs
    plan_cancelled: false,
    plan_interval: null,         // "monthly" | "yearly"
    subscriber_email: null,
    stripe_customer_id: null,
    referral_code: null,
    referred_by: null,
    bonus_rows: 0,
    referrals_sent: [],
    referrals_received_pro: 0,
    usage_by_month: {},          // { "2026-05": <rows_used> }
    install_ts: Date.now(),
  };
}

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function ensureUser(userId) {
  let user = getUser(userId);
  if (!user) {
    user = defaultUser();
    user.user_id = userId;
    user.referral_code = generateReferralCode();
    updateUser(userId, user);
  }
  if (!user.referral_code) {
    user.referral_code = generateReferralCode();
    updateUser(userId, { referral_code: user.referral_code });
  }
  return user;
}

export function getPlanState(userId) {
  const user = ensureUser(userId);
  // Check ambassador / time-limited Pro expiry
  if (user.plan !== "free" && user.plan_expires_ts && Date.now() > user.plan_expires_ts) {
    updateUser(userId, { plan: "free", plan_cancelled: false, plan_expires_ts: null });
    user.plan = "free";
  }
  const planDef = PLANS[user.plan] || PLANS.free;
  const month = currentYearMonth();
  const used = user.usage_by_month?.[month] || 0;
  const bonus = user.bonus_rows || 0;
  const totalQuota = planDef.monthly_quota === -1 ? Infinity : (planDef.monthly_quota + bonus);
  const remaining = totalQuota === Infinity ? Infinity : Math.max(0, totalQuota - used);
  return {
    plan: user.plan,
    plan_name: planDef.name,
    plan_interval: user.plan_interval,
    plan_source: user.plan_source,
    plan_expires_ts: user.plan_expires_ts,
    plan_cancelled: !!user.plan_cancelled,
    price_jpy: planDef.price_jpy,
    quota_used: used,
    quota_total: totalQuota === Infinity ? "unlimited" : totalQuota,
    quota_remaining: remaining === Infinity ? "unlimited" : remaining,
    bonus_rows: bonus,
    blocked: remaining !== Infinity && remaining <= 0,
    referral_code: user.referral_code,
    subscriber_email: user.subscriber_email,
    month,
  };
}

export function consumeRows(userId, count) {
  if (!count || count <= 0) return;
  const user = ensureUser(userId);
  const month = currentYearMonth();
  const cur = user.usage_by_month?.[month] || 0;
  const newUsage = { ...(user.usage_by_month || {}), [month]: cur + count };
  updateUser(userId, { usage_by_month: newUsage });
}

export function setPro(userId, { plan = "starter", interval = "monthly", expires_ts = null, source = "stripe", email = null, stripe_customer_id = null } = {}) {
  return updateUser(userId, {
    plan,
    plan_source: source,
    plan_interval: interval,
    plan_expires_ts: expires_ts,
    plan_cancelled: false,
    subscriber_email: email,
    stripe_customer_id,
    plan_started_ts: Date.now(),
  });
}

export function cancelPro(userId, expires_ts = null) {
  return updateUser(userId, { plan_cancelled: true, plan_expires_ts: expires_ts });
}

export function applyReferralCode(userId, code) {
  if (!code || typeof code !== "string") return { ok: false, error: "コードが無効です" };
  code = code.toUpperCase().trim();
  const user = ensureUser(userId);
  if (user.referred_by) return { ok: false, error: "招待コードは既に適用済みです" };
  if (user.referral_code === code) return { ok: false, error: "自分のコードは使えません" };
  if (user.plan !== "free") return { ok: false, error: "すでに有料プランです" };

  // Ambassador code → 半年Pro
  if (code.startsWith(AMBASSADOR_PREFIX)) {
    const expires = Date.now() + AMBASSADOR_PRO_DAYS * 86400000;
    setPro(userId, { plan: "pro", interval: "ambassador", expires_ts: expires, source: "ambassador" });
    updateUser(userId, { referred_by: code, ambassador_code: code });
    return { ok: true, type: "ambassador", days: AMBASSADOR_PRO_DAYS };
  }

  // Regular referral: bonus rows
  updateUser(userId, {
    referred_by: code,
    bonus_rows: (user.bonus_rows || 0) + REFERRAL_REWARD_INVITEE_BONUS_ROWS,
  });
  return { ok: true, type: "regular", bonus_rows: REFERRAL_REWARD_INVITEE_BONUS_ROWS };
}

export function getReferralShareInfo(userId, hostUrl) {
  const user = ensureUser(userId);
  const baseUrl = hostUrl || "https://arealead.app";
  const shareUrl = `${baseUrl}/?ref=${user.referral_code}`;
  return {
    code: user.referral_code,
    share_url: shareUrl,
    share_text: `営業リスト自動生成のAreaLeadを使ってます。私のコード「${user.referral_code}」を入れて登録すると、双方が1ヶ月Proに、招待された側は無料枠+${REFERRAL_REWARD_INVITEE_BONUS_ROWS}行のボーナス付き🎁\n${shareUrl}`,
    referrals_sent_count: (user.referrals_sent || []).length,
    referrals_pro_count: user.referrals_received_pro || 0,
    rewards_months_earned: (user.referrals_received_pro || 0) * REFERRAL_REWARD_INVITER_MONTHS,
  };
}

export function getCheckoutUrl(planType = "starter") {
  if (planType === "pro") return STRIPE_LINKS.pro_monthly;
  return STRIPE_LINKS.starter_monthly;
}
