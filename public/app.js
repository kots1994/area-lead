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
let lastProperty = null;

const KEY_GOOGLE = "al.key.google";
const KEY_ANTHROPIC = "al.key.anthropic";
function getStoredKeys() {
  return {
    google_maps: localStorage.getItem(KEY_GOOGLE) || "",
    anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
  };
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin" };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  return r.json();
}

function setBusy(b, label = "リスト生成") {
  btn.disabled = b;
  spinner.hidden = !b;
  btnLabel.textContent = b ? "生成中..." : `📡 ${label}`;
}
function setStatus(msg, type = "") { status.textContent = msg; status.className = "status " + type; }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function truncate(s, n = 50) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; }

// ─── API settings modal ───────────────────────────────
function openApiSettings() {
  const k = getStoredKeys();
  $("key-google").value = k.google_maps;
  $("key-anthropic").value = k.anthropic;
  $("api-settings-modal").hidden = false;
  $("api-settings-status").textContent = "";
  setTimeout(() => $("key-google").focus(), 100);
}
function closeApiSettings() { $("api-settings-modal").hidden = true; }
$("btn-open-api-settings")?.addEventListener("click", openApiSettings);
$("btn-close-api-settings")?.addEventListener("click", closeApiSettings);
$("api-settings-modal")?.addEventListener("click", (e) => { if (e.target.id === "api-settings-modal") closeApiSettings(); });
$("api-settings-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const g = $("key-google").value.trim();
  const a = $("key-anthropic").value.trim();
  if (g) localStorage.setItem(KEY_GOOGLE, g); else localStorage.removeItem(KEY_GOOGLE);
  if (a) localStorage.setItem(KEY_ANTHROPIC, a); else localStorage.removeItem(KEY_ANTHROPIC);
  $("api-settings-status").textContent = "✓ 保存しました";
  $("api-settings-status").className = "modal-status success";
  setTimeout(closeApiSettings, 800);
});
$("btn-clear-keys")?.addEventListener("click", () => {
  localStorage.removeItem(KEY_GOOGLE);
  localStorage.removeItem(KEY_ANTHROPIC);
  $("key-google").value = "";
  $("key-anthropic").value = "";
  $("api-settings-status").textContent = "クリアしました";
  $("api-settings-status").className = "modal-status info";
});

// ─── Render ───────────────────────────────────────────
function priorityBadge(p) {
  if (!p || p === "☆☆☆") return '<span class="pri pri-0">☆☆☆</span>';
  if (p === "★★★") return '<span class="pri pri-3">★★★</span>';
  if (p === "★★☆") return '<span class="pri pri-2">★★☆</span>';
  return '<span class="pri pri-1">★☆☆</span>';
}
function renderRows(rows) {
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="8"><div class="empty-state"><h3>該当する企業が見つかりませんでした</h3><p>エリア・キーワードを変えて試してみてください。</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const emails = (r.emails || "").split(";").filter(Boolean);
    const emailHtml = emails.length > 0
      ? `<a href="mailto:${escapeHtml(emails[0])}">${escapeHtml(emails[0])}</a>${emails.length > 1 ? ` <small>+${emails.length-1}</small>` : ""}`
      : '<span class="badge no">—</span>';
    const formBadge = r.has_inquiry_form ? '<span class="badge ok">フォーム</span>' : '';
    const cnBadge = r.chinese_or_ec_emerging ? '<span class="badge accent">EC新興</span>' : '';
    return `
      <tr class="${r.priority === "★★★" ? "row-p3" : (r.priority === "★★☆" ? "row-p2" : "")}">
        <td>${priorityBadge(r.priority)}</td>
        <td><span class="rev-tag">${escapeHtml(r.revenue_rank || "—")}</span></td>
        <td class="cell-name">${escapeHtml(r.name)} ${cnBadge}</td>
        <td class="cell-addr">${escapeHtml(truncate(r.address, 40))}</td>
        <td class="cell-phone">${escapeHtml(r.phone || "—")}</td>
        <td class="cell-web">${r.website ? `<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener">${escapeHtml(truncate(r.website.replace(/^https?:\/\//, ''), 24))}</a>` : "—"}</td>
        <td class="cell-email">${emailHtml}${formBadge ? ' ' + formBadge : ''}</td>
        <td class="cell-reason">${escapeHtml(truncate(r.reason || "", 80))}</td>
      </tr>
    `;
  }).join("");
}

// ─── Main submit ──────────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKeys = getStoredKeys();
  if (!apiKeys.google_maps) {
    setStatus("Google Maps API キーが未設定。右上「⚙️ API設定」から登録してください。", "error");
    openApiSettings();
    return;
  }
  const property = {
    name: $("f-name").value.trim(),
    address: $("f-address").value.trim(),
    hook: $("f-hook").value.trim(),
    areas: $("f-areas").value.split(/[,、]/).map((s) => s.trim()).filter(Boolean),
  };
  if (!property.name) { setStatus("物件名を入力してください", "error"); return; }
  if (property.areas.length === 0) { setStatus("対象エリアを入力してください", "error"); return; }

  const keywords = $("f-keywords").value.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  const options = {
    enrichWithAi: $("f-enrich-ai").checked,
    scrape: $("f-scrape").checked,
    language: "ja",
    region: "JP",
  };

  if (options.enrichWithAi && !apiKeys.anthropic) {
    if (!confirm("Anthropic Claude API キーが未設定です。優先度判定なしで続けますか？\n（OK: 続ける / キャンセル: API設定を開く）")) {
      openApiSettings();
      return;
    }
  }

  setBusy(true);
  setStatus("Phase 1: Google Maps を検索中...", "info");
  btnCsv.hidden = true;
  try {
    const data = await api("POST", "/api/generate", { property, keywords, apiKeys, options });
    if (!data.ok) {
      if (data.needApiKey) { openApiSettings(); }
      throw new Error(data.error || "unknown error");
    }
    renderRows(data.rows);
    let countText = `${data.counts.returned}社（元データ ${data.counts.found}社）`;
    const costParts = [];
    if (data.maps_usage) {
      const m = data.maps_usage;
      costParts.push(`Google Maps: $${m.cost_usd.toFixed(3)}（≈¥${m.cost_jpy} / ${m.request_count}リクエスト）`);
    }
    if (data.claude_usage) {
      const u = data.claude_usage;
      const costStr = u.cost_usd < 0.001
        ? `$${(u.cost_usd * 1000).toFixed(2)}m`
        : `$${u.cost_usd.toFixed(4)}`;
      costParts.push(`Claude: ${costStr}（≈¥${u.cost_jpy}）`);
    }
    if (costParts.length > 0) countText += `  ―  💰 ${costParts.join(" + ")}`;
    resultsCount.textContent = countText;
    lastCsvBase64 = data.csv_base64;
    lastProperty = data.property;
    btnCsv.hidden = false;
    setStatus(`✓ ${data.counts.returned}社のアタックリストを生成しました`, "success");
  } catch (err) {
    setStatus(`エラー: ${err.message}`, "error");
    tbody.innerHTML = `<tr class="empty"><td colspan="8"><div class="empty-state"><h3>エラー</h3><p>${escapeHtml(err.message)}</p></div></td></tr>`;
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
  const safe = (lastProperty || "arealead").replace(/[^a-z0-9一-龥ぁ-んァ-ヶー_-]/gi, "_").slice(0, 60);
  a.href = url;
  a.download = `${safe}_アタックリスト_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Init: 初回 API キー未設定なら設定モーダル
(() => {
  if (!getStoredKeys().google_maps) setTimeout(openApiSettings, 400);
})();
