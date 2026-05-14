const $ = (id) => document.getElementById(id);
const form = $("search-form");
const btn = $("btn-search");
const spinner = btn.querySelector(".btn-spinner");
const btnLabel = btn.querySelector(".btn-label");
const status = $("status");
const tbody = $("results-body");
const resultsCount = $("results-count");
const btnCsv = $("btn-csv");

let lastCsvBase64 = null;
let lastQuery = null;
let planState = null;

function setBusy(isBusy) {
  btn.disabled = isBusy;
  spinner.hidden = !isBusy;
  btnLabel.textContent = isBusy ? "生成中..." : "リスト生成";
}
function setStatus(msg, type = "") { status.textContent = msg; status.className = "status " + type; }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function truncate(s, n = 50) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; }

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(path, opts);
  return resp.json();
}

// ─── Auth gate ─────────────────────────────────────────
let currentUser = null;
async function ensureLoggedIn() {
  try {
    const r = await api("GET", "/api/auth/me");
    if (r.ok && r.data) { currentUser = r.data; return true; }
  } catch {}
  location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
  return false;
}

async function logout() {
  try { await api("POST", "/api/auth/logout"); } catch {}
  location.href = "/login.html";
}

// ─── Plan state ────────────────────────────────────────
async function loadPlanState() {
  try {
    const r = await api("GET", "/api/plan/state");
    if (r.status === 401 || r.needLogin) { location.href = "/login.html?next=/"; return; }
    if (r.ok) planState = r.data;
    renderPlanBadge();
    renderQuotaMeter();
    renderUserMenu();
  } catch {}
}

function renderUserMenu() {
  // Insert email + logout into header if not present
  let menu = document.querySelector(".header-user");
  if (!menu) {
    const headerPlan = document.querySelector(".header-plan");
    if (!headerPlan) return;
    menu = document.createElement("div");
    menu.className = "header-user";
    headerPlan.appendChild(menu);
  }
  if (currentUser) {
    menu.innerHTML = `<span class="user-email">${escapeHtml(currentUser.email)}</span> <button class="user-logout" id="btn-logout">ログアウト</button>`;
    document.getElementById("btn-logout")?.addEventListener("click", logout);
  }
}
function renderPlanBadge() {
  const badge = $("header-plan-badge");
  if (!badge || !planState) return;
  const m = { free: "Free", starter: "Starter", pro: "✨ Pro", enterprise: "Enterprise" };
  badge.textContent = m[planState.plan] || planState.plan_name;
  badge.className = "header-plan-badge plan-" + planState.plan;
  if (planState.plan_cancelled) badge.textContent += " (解約済)";
}
function renderQuotaMeter() {
  const meter = $("quota-meter");
  if (!meter || !planState) return;
  if (planState.quota_total === "unlimited") {
    meter.hidden = false;
    $("quota-value").textContent = `${planState.quota_used} 行 (無制限)`;
    $("quota-bar-fill").style.width = "30%";
    $("quota-upgrade-link").hidden = true;
    return;
  }
  meter.hidden = false;
  const used = planState.quota_used || 0;
  const total = planState.quota_total || 50;
  const pct = Math.min(100, (used / total) * 100);
  $("quota-value").textContent = `${used} / ${total} 行`;
  $("quota-bar-fill").style.width = `${pct}%`;
  $("quota-bar-fill").classList.remove("warning", "danger");
  if (pct > 90) $("quota-bar-fill").classList.add("danger");
  else if (pct > 70) $("quota-bar-fill").classList.add("warning");
  $("quota-upgrade-link").hidden = planState.plan !== "free";
}

// ─── Paywall ──────────────────────────────────────────
function showPaywall() { $("paywall-modal").hidden = false; }
function hidePaywall() {
  $("paywall-modal").hidden = true;
  $("referral-input-row").hidden = true;
  $("referral-feedback").textContent = "";
}
$("btn-paywall-close")?.addEventListener("click", hidePaywall);
$("paywall-modal")?.addEventListener("click", (e) => { if (e.target.id === "paywall-modal") hidePaywall(); });
document.querySelectorAll(".modal-cta[data-plan]").forEach((b) => {
  b.addEventListener("click", async () => {
    const plan = b.dataset.plan;
    const r = await api("POST", "/api/plan/upgrade-link", { plan });
    if (r.ok) location.href = r.data.url;
  });
});

$("btn-have-referral")?.addEventListener("click", () => {
  const row = $("referral-input-row");
  row.hidden = !row.hidden;
  if (!row.hidden) $("referral-input").focus();
});
$("btn-apply-referral")?.addEventListener("click", async () => {
  const code = ($("referral-input").value || "").toUpperCase().trim();
  if (!code) return;
  const fb = $("referral-feedback");
  try {
    const r = await api("POST", "/api/referral/apply", { code });
    if (r.ok) {
      fb.textContent = r.data.type === "ambassador"
        ? `✓ アンバサダーコード適用！${r.data.days}日間 Pro になりました 🎉`
        : `✓ 招待コード適用！無料枠が ${r.data.bonus_rows} 行追加されました 🎉`;
      fb.className = "referral-feedback success";
      await loadPlanState();
      setTimeout(hidePaywall, 1500);
    } else {
      fb.textContent = r.data?.error || "コードが無効です";
      fb.className = "referral-feedback error";
    }
  } catch (e) {
    fb.textContent = e.message;
    fb.className = "referral-feedback error";
  }
});

// ─── AI polish modal ──────────────────────────────────
let currentAiStyle = "polite";
function openAiModal(prefillText = "") {
  $("ai-input").value = prefillText;
  $("ai-result").hidden = true;
  $("ai-modal").hidden = false;
}
function closeAiModal() { $("ai-modal").hidden = true; }
$("btn-ai-close")?.addEventListener("click", closeAiModal);
$("btn-ai-cancel")?.addEventListener("click", closeAiModal);
$("ai-modal")?.addEventListener("click", (e) => { if (e.target.id === "ai-modal") closeAiModal(); });

document.querySelectorAll(".ai-style").forEach((b) => {
  b.addEventListener("click", async () => {
    document.querySelectorAll(".ai-style").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    currentAiStyle = b.dataset.style;
    const text = $("ai-input").value.trim();
    if (!text) { return; }
    $("ai-loading").hidden = false;
    $("ai-result").hidden = true;
    try {
      const r = await api("POST", "/api/ai/polish", { text, style: currentAiStyle, purpose: "reason" });
      if (r.ok) {
        $("ai-result-text").value = r.data.polished;
        $("ai-result").hidden = false;
      } else {
        alert(r.error);
      }
    } finally { $("ai-loading").hidden = true; }
  });
});
$("btn-ai-copy")?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("ai-result-text").value); $("btn-ai-copy").textContent = "✓ コピー済"; setTimeout(() => $("btn-ai-copy").textContent = "コピー", 1500); } catch {}
});

// ─── Dev panel ────────────────────────────────────────
document.querySelectorAll(".dev-btn[data-mode]").forEach((b) => {
  b.addEventListener("click", async () => {
    try {
      await api("POST", "/api/dev/set-state", { mode: b.dataset.mode });
      await loadPlanState();
      alert(`モード切替: ${b.dataset.mode}`);
    } catch (e) { alert(e.message); }
  });
});
if (location.search.includes("dev=1")) {
  $("dev-panel").hidden = false;
}

// ─── Main search ──────────────────────────────────────
function renderRows(rows) {
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="7">該当する企業が見つかりませんでした。条件を緩めてみてください。</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const emails = (r.emails || "").split(";").filter(Boolean);
    const emailHtml = emails.length > 0
      ? `<a href="mailto:${escapeHtml(emails[0])}">${escapeHtml(emails[0])}</a>${emails.length > 1 ? ` <small>+${emails.length-1}</small>` : ""}`
      : '<span class="badge no">未取得</span>';
    const formBadge = r.has_inquiry_form ? '<span class="badge ok">あり</span>' : '<span class="badge no">なし</span>';
    return `
      <tr>
        <td class="cell-name">${escapeHtml(r.name)}</td>
        <td class="cell-addr">${escapeHtml(r.address)}</td>
        <td class="cell-phone">${escapeHtml(r.phone || "—")}</td>
        <td class="cell-web">${r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener">${escapeHtml(truncate(r.website.replace(/^https?:\/\//, ''), 28))}</a>` : "—"}</td>
        <td class="cell-email">${emailHtml}</td>
        <td>${formBadge}</td>
        <td>${r.rating ? `${r.rating} (${r.review_count})` : "—"}</td>
      </tr>
    `;
  }).join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    industry: $("f-industry").value.trim(),
    area: $("f-area").value.trim(),
    keywords: $("f-keywords").value.trim(),
    language: $("f-language").value,
    region: $("f-region").value,
    max: Number($("f-max").value) || 20,
    enrich: $("f-enrich").checked,
  };
  if (!body.industry && !body.keywords) { setStatus("業種かキーワードを入力してください", "error"); return; }
  if (!body.area) { setStatus("エリアを入力してください", "error"); return; }

  setBusy(true);
  setStatus("Google Maps を検索中...", "info");
  btnCsv.hidden = true;
  try {
    const resp = await fetch("/api/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (resp.status === 402) {
      // Paywall
      planState = data.planState;
      renderPlanBadge();
      renderQuotaMeter();
      showPaywall();
      setStatus("", "");
      return;
    }
    if (!data.ok) throw new Error(data.error || "unknown error");
    renderRows(data.rows);
    resultsCount.textContent = `${data.count}件`;
    lastCsvBase64 = data.csv_base64;
    lastQuery = data.query;
    btnCsv.hidden = false;
    setStatus(`✓ ${data.count}件のリストを生成しました`, "success");
    if (data.planState) { planState = data.planState; renderPlanBadge(); renderQuotaMeter(); }
  } catch (err) {
    setStatus(`エラー: ${err.message}`, "error");
    tbody.innerHTML = `<tr class="empty"><td colspan="7">エラーが発生しました: ${escapeHtml(err.message)}</td></tr>`;
  } finally { setBusy(false); }
});

btnCsv.addEventListener("click", () => {
  if (!lastCsvBase64) return;
  const bin = atob(lastCsvBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (lastQuery || "arealead").replace(/[^a-z0-9一-龥ぁ-んァ-ヶー_-]/gi, "_").slice(0, 60);
  a.href = url;
  a.download = `arealead_${safe}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Init: ensure logged in then load plan
(async () => {
  if (await ensureLoggedIn()) {
    await loadPlanState();
  }
})();
