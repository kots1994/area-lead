// Simple file-backed JSON storage for plan/quota/feedback/referral.
// MVP-only; production should swap for Postgres/Supabase.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", ".data");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function pathFor(key) {
  ensureDir();
  return path.join(DATA_DIR, `${key}.json`);
}

export function readJson(key, fallback = {}) {
  try {
    const p = pathFor(key);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch { return fallback; }
}

export function writeJson(key, data) {
  const p = pathFor(key);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

export function appendArrayJson(key, entry) {
  const arr = readJson(key, []);
  arr.push(entry);
  writeJson(key, arr);
}

// ─── User keyed storage helpers ────────────────────────
const USERS_KEY = "users";

export function getUser(userId) {
  const all = readJson(USERS_KEY, {});
  return all[userId] || null;
}

export function setUser(userId, data) {
  const all = readJson(USERS_KEY, {});
  all[userId] = data;
  writeJson(USERS_KEY, all);
}

export function updateUser(userId, patch) {
  const all = readJson(USERS_KEY, {});
  all[userId] = { ...(all[userId] || {}), ...patch };
  writeJson(USERS_KEY, all);
  return all[userId];
}
