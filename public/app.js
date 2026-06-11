const $ = (id) => document.getElementById(id);
const form = $("search-form");
const btn = $("btn-search");
const spinner = btn.querySelector(".btn-spinner");
const btnLabel = btn.querySelector(".btn-label");
const status = $("status");
const tbody = $("results-body");
const resultsCount = $("results-count");
const btnCsv = $("btn-csv");
const btnSheet = $("btn-sheet");

let lastCsvBase64 = null;
let lastProperty = null;
let lastRows = null;
let currentMode = "area";

const KEY_GOOGLE = "al.key.google";
const KEY_ANTHROPIC = "al.key.anthropic";
const KEY_GCLIENT = "al.key.gclient";
const KEY_SHEET = "al.sheet.id";
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
  btnLabel.textContent = b ? "生成中..." : `${label}`;
}
function setStatus(msg, type = "") { status.textContent = msg; status.className = "status " + type; }
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function truncate(s, n = 50) { s = String(s ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; }

// ─── Chips input ─────────────────────────────────────
const chipList = $("chip-list");
const chipText = $("chip-text");
const fAreas  = $("f-areas");
let chips = [];

function renderChips() {
  chipList.innerHTML = chips.map((c, i) =>
    `<span class="chip">${escapeHtml(c)}<button type="button" class="chip-del" data-i="${i}">×</button></span>`
  ).join("");
  fAreas.value = chips.join(",");
}
chipList?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip-del");
  if (!btn) return;
  chips.splice(+btn.dataset.i, 1);
  renderChips();
});
chipText?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const v = chipText.value.replace(/,/g,"").trim();
    if (v && !chips.includes(v)) { chips.push(v); renderChips(); }
    chipText.value = "";
  }
  if (e.key === "Backspace" && chipText.value === "" && chips.length) {
    chips.pop(); renderChips();
  }
});
chipText?.addEventListener("blur", () => {
  const v = chipText.value.replace(/,/g,"").trim();
  if (v && !chips.includes(v)) { chips.push(v); renderChips(); }
  chipText.value = "";
});
$("chip-input-wrap")?.addEventListener("click", () => chipText?.focus());

// ─── Search mode toggle ───────────────────────────────
function applySearchMode(mode) {
  currentMode = mode;
  $("mode-area-section").hidden      = mode !== "area";
  $("mode-radius-section").hidden    = mode !== "radius";
  $("mode-drivetime-section").hidden = mode !== "drivetime";
}
document.querySelectorAll('input[name="search-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => applySearchMode(radio.value));
});
applySearchMode("area");

// ─── API settings modal ───────────────────────────────
function openApiSettings() {
  const k = getStoredKeys();
  $("key-google").value = k.google_maps;
  $("key-anthropic").value = k.anthropic;
  $("key-gclient").value = localStorage.getItem(KEY_GCLIENT) || "";
  $("key-sheet").value = localStorage.getItem(KEY_SHEET) || "";
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
  const gc = $("key-gclient").value.trim();
  const sh = $("key-sheet").value.trim();
  if (gc) localStorage.setItem(KEY_GCLIENT, gc); else localStorage.removeItem(KEY_GCLIENT);
  if (sh) localStorage.setItem(KEY_SHEET, sh); else localStorage.removeItem(KEY_SHEET);
  $("api-settings-status").textContent = "✓ 保存しました";
  $("api-settings-status").className = "modal-status success";
  setTimeout(closeApiSettings, 800);
});
$("btn-clear-keys")?.addEventListener("click", () => {
  localStorage.removeItem(KEY_GOOGLE);
  localStorage.removeItem(KEY_ANTHROPIC);
  localStorage.removeItem(KEY_GCLIENT);
  localStorage.removeItem(KEY_SHEET);
  $("key-google").value = "";
  $("key-anthropic").value = "";
  $("key-gclient").value = "";
  $("key-sheet").value = "";
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
        <td class="cell-drive" ${$("th-drive")?.hidden ? 'hidden' : ''}>${r.drive_minutes != null ? `${r.drive_minutes}分` : "—"}</td>
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
    setStatus("Google Maps API キーが未設定。右上「API設定」から登録してください。", "error");
    openApiSettings();
    return;
  }
  const property = {
    name: $("f-name").value.trim(),
    address: $("f-address").value.trim(),
    pin: $("f-pin").value.trim(),
    hook: $("f-hook").value.trim(),
    areas: fAreas.value.split(/[,、]/).map((s) => s.trim()).filter(Boolean),
  };
  if (!property.name && !property.address && !property.pin) {
    setStatus("物件名・住所・ピンのいずれかを入力してください", "error"); return;
  }
  if (currentMode === "area" && property.areas.length === 0) {
    setStatus("対象エリアを入力してください", "error"); return;
  }
  if ((currentMode === "radius" || currentMode === "drivetime") && !property.address && !property.name && !property.pin) {
    setStatus("このモードには住所・物件名・ピンのいずれか（基点）が必要です", "error"); return;
  }

  const keywords = $("f-keywords").value.split(/[,、]/).map((s) => s.trim()).filter(Boolean);
  const options = {
    enrichWithAi: $("f-enrich-ai").checked,
    scrape: $("f-scrape").checked,
    language: "ja",
    region: "JP",
    searchMode: currentMode,
    radiusKm: currentMode === "radius" ? (+$("f-radius-km").value || 20) : undefined,
    drivetimeMinutes: +$("f-drivetime-min")?.value || 30,
  };

  if (options.enrichWithAi && !apiKeys.anthropic) {
    if (!confirm("Anthropic Claude API キーが未設定です。優先度判定なしで続けますか？\n（OK: 続ける / キャンセル: API設定を開く）")) {
      openApiSettings();
      return;
    }
  }

  setBusy(true);
  const modeLabel = { area: "エリア", radius: "半径", drivetime: "車時間" }[currentMode] || "";
  setStatus(`Phase 1: Google Maps を検索中... [${modeLabel}モード]`, "info");
  btnCsv.hidden = true;
  btnSheet.hidden = true;
  $("th-drive").hidden = (currentMode !== "drivetime");
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
    if (data.drivetime_usage) {
      const d = data.drivetime_usage;
      costParts.push(`所要時間フィルタ: $${d.cost_usd.toFixed(3)}（≈¥${d.cost_jpy} / ${d.max_minutes}分以内）`);
    }
    if (costParts.length > 0) countText += `  ―  ${costParts.join(" + ")}`;
    resultsCount.textContent = countText;
    lastCsvBase64 = data.csv_base64;
    lastProperty = data.property;
    lastRows = data.rows;
    btnCsv.hidden = false;
    btnSheet.hidden = !(data.rows && data.rows.length > 0);
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

// ─── Google Sheets 出力（新しいタブとして追加）──────────
// ブラウザ内OAuth(GIS)でユーザー自身のGoogleアカウントから直接書き込む。サーバーは経由しない。
const SHEET_COLUMNS = [
  ["priority", "優先度"], ["revenue_rank", "売上ランク"], ["category", "業種"],
  ["name", "企業名"], ["address", "住所"], ["phone", "電話"], ["website", "サイト"],
  ["emails", "メール"], ["contact_url", "問い合わせURL"], ["has_inquiry_form", "フォーム有"],
  ["reason", "候補理由"], ["estimated_department", "推定担当部署"],
  ["drive_minutes", "車(分)"], ["drive_distance_km", "距離(km)"],
  ["rating", "評価"], ["review_count", "クチコミ数"],
  ["chinese_or_ec_emerging", "EC新興"], ["maps_url", "Maps URL"],
];

function parseSpreadsheetId(input) {
  const m = String(input || "").match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(String(input || "").trim())) return input.trim();
  return null;
}

let gisToken = null; // { access_token, expires_at }
function getSheetsToken(clientId) {
  return new Promise((resolve, reject) => {
    if (gisToken && gisToken.expires_at > Date.now() + 60_000) return resolve(gisToken.access_token);
    if (!window.google?.accounts?.oauth2) return reject(new Error("Google認証ライブラリの読込待ちです。数秒後にもう一度お試しください"));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      callback: (resp) => {
        if (resp.error) return reject(new Error(`Google認証エラー: ${resp.error}`));
        gisToken = { access_token: resp.access_token, expires_at: Date.now() + (resp.expires_in || 3600) * 1000 };
        resolve(gisToken.access_token);
      },
    });
    tc.requestAccessToken();
  });
}

async function sheetsApi(token, method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Sheets API ${r.status}`);
  return data;
}

btnSheet?.addEventListener("click", async () => {
  if (!lastRows || lastRows.length === 0) return;
  const clientId = localStorage.getItem(KEY_GCLIENT) || "";
  const sheetId = parseSpreadsheetId(localStorage.getItem(KEY_SHEET) || "");
  if (!clientId || !sheetId) {
    setStatus("Sheet出力には「API設定」で OAuthクライアントID と 出力先スプレッドシート の設定が必要です", "error");
    openApiSettings();
    return;
  }
  btnSheet.disabled = true;
  try {
    setStatus("Googleアカウントで認可中...", "info");
    const token = await getSheetsToken(clientId);

    // タブ名: 物件名_月日-時分（重複時は連番サフィックス）
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const base = `${(lastProperty || "AreaLead").replace(/[\[\]:*?\/\\]/g, "_").slice(0, 60)}_${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    setStatus("新しいタブを作成中...", "info");
    let title = base, added = null;
    for (let i = 0; i < 3; i++) {
      try {
        added = await sheetsApi(token, "POST", `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
          requests: [{ addSheet: { properties: { title } } }],
        });
        break;
      } catch (e) {
        if (/already exists/i.test(e.message)) { title = `${base}_${i + 2}`; continue; }
        throw e;
      }
    }
    if (!added) throw new Error("タブ名が重複しています。時間をおいて再実行してください");
    const gid = added.replies?.[0]?.addSheet?.properties?.sheetId;

    setStatus(`${lastRows.length}社を書き込み中...`, "info");
    const values = [
      SHEET_COLUMNS.map(([, label]) => label),
      ...lastRows.map((r) => SHEET_COLUMNS.map(([key]) => {
        const v = r[key];
        if (v === null || v === undefined) return "";
        if (Array.isArray(v)) return v.join(", ");
        if (typeof v === "boolean") return v ? "TRUE" : "";
        return String(v);
      })),
    ];
    await sheetsApi(token, "PUT",
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=RAW`,
      { values });

    const link = `https://docs.google.com/spreadsheets/d/${sheetId}/edit${gid != null ? `#gid=${gid}` : ""}`;
    status.className = "status success";
    status.innerHTML = `✓ Sheetにタブ「${escapeHtml(title)}」を追加しました（${lastRows.length}社） <a href="${link}" target="_blank" rel="noopener">開く →</a>`;
  } catch (err) {
    setStatus(`Sheet出力エラー: ${err.message}`, "error");
  } finally {
    btnSheet.disabled = false;
  }
});

// Init: 初回 API キー未設定なら設定モーダル
(() => {
  if (!getStoredKeys().google_maps) setTimeout(openApiSettings, 400);
})();
