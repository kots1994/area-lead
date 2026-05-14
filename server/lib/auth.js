// Email + password auth for AreaLead
// File-based user storage (MVP). Production should migrate to Postgres / Supabase.

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { readJson, writeJson } from "./storage.js";

const ACCOUNTS_KEY = "accounts";     // { email -> { user_id, email, password_hash, created_ts } }
const SESSIONS_KEY = "sessions";     // { session_id -> { user_id, email, created_ts, expires_ts } }
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function normEmail(e) { return String(e || "").trim().toLowerCase(); }

export async function registerAccount({ email, password }) {
  email = normEmail(email);
  if (!email || !email.includes("@")) return { ok: false, error: "正しいメールアドレスを入力してください" };
  if (!password || password.length < 8) return { ok: false, error: "パスワードは8文字以上で入力してください" };
  const accounts = readJson(ACCOUNTS_KEY, {});
  if (accounts[email]) return { ok: false, error: "このメールアドレスは既に登録されています。ログインしてください" };
  const user_id = crypto.randomUUID();
  const password_hash = await bcrypt.hash(password, 10);
  accounts[email] = { user_id, email, password_hash, created_ts: Date.now() };
  writeJson(ACCOUNTS_KEY, accounts);
  return { ok: true, user_id, email };
}

export async function loginAccount({ email, password }) {
  email = normEmail(email);
  if (!email || !password) return { ok: false, error: "メールアドレスとパスワードを入力してください" };
  const accounts = readJson(ACCOUNTS_KEY, {});
  const a = accounts[email];
  if (!a) return { ok: false, error: "メールアドレスまたはパスワードが正しくありません" };
  const ok = await bcrypt.compare(password, a.password_hash);
  if (!ok) return { ok: false, error: "メールアドレスまたはパスワードが正しくありません" };
  return { ok: true, user_id: a.user_id, email };
}

export function createSession({ user_id, email }) {
  const session_id = crypto.randomBytes(32).toString("hex");
  const sessions = readJson(SESSIONS_KEY, {});
  sessions[session_id] = {
    user_id, email,
    created_ts: Date.now(),
    expires_ts: Date.now() + SESSION_TTL_MS,
  };
  writeJson(SESSIONS_KEY, sessions);
  return { session_id, expires_ts: Date.now() + SESSION_TTL_MS };
}

export function getSession(session_id) {
  if (!session_id) return null;
  const sessions = readJson(SESSIONS_KEY, {});
  const s = sessions[session_id];
  if (!s) return null;
  if (Date.now() > s.expires_ts) {
    delete sessions[session_id];
    writeJson(SESSIONS_KEY, sessions);
    return null;
  }
  return s;
}

export function destroySession(session_id) {
  if (!session_id) return;
  const sessions = readJson(SESSIONS_KEY, {});
  delete sessions[session_id];
  writeJson(SESSIONS_KEY, sessions);
}

export async function changePassword({ email, currentPassword, newPassword }) {
  email = normEmail(email);
  const accounts = readJson(ACCOUNTS_KEY, {});
  const a = accounts[email];
  if (!a) return { ok: false, error: "アカウントが見つかりません" };
  const ok = await bcrypt.compare(currentPassword, a.password_hash);
  if (!ok) return { ok: false, error: "現在のパスワードが正しくありません" };
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "新しいパスワードは8文字以上で入力してください" };
  a.password_hash = await bcrypt.hash(newPassword, 10);
  accounts[email] = a;
  writeJson(ACCOUNTS_KEY, accounts);
  return { ok: true };
}
