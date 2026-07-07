// 業種別エマージング検索 (フリー入力版)
const $ = (id) => document.getElementById(id);

let chips = [];
let lastCsvBase64 = null;

const KEY_GOOGLE = "al.key.google";
const KEY_ANTHROPIC = "al.key.anthropic";
const KEY_LAST_KW = "al.industry.lastKeywords";
const KEY_LAST_EXCLUDE = "al.industry.lastExclude";
function getStoredKeys() {
  return {
    google_maps: localStorage.getItem(KEY_GOOGLE) || "",
    anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
  };
}

// ─── エリアchip入力 ───────────────────────
function renderChips() {
  $("chip-list").innerHTML = chips.map((a, i) => `
    <span class="chip">${a}<button type="button" data-idx="${i}">×</button></span>
  `).join("");
  $("f-areas").value = chips.join(",");
  document.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => { chips.splice(+btn.dataset.idx, 1); renderChips(); });
  });
}
$("chip-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const v = $("chip-text").value.trim().replace(/,$/, "");
    if (v && !chips.includes(v)) { chips.push(v); renderChips(); }
    $("chip-text").value = "";
  } else if (e.key === "Backspace" && !$("chip-text").value && chips.length) {
    chips.pop(); renderChips();
  }
});

// ─── API設定モーダル ───────────────────────
function openApiSettings() {
  const k = getStoredKeys();
  $("key-google").value = k.google_maps;
  $("key-anthropic").value = k.anthropic;
  $("api-settings-modal").hidden = false;
}
$("btn-open-api-settings")?.addEventListener("click", openApiSettings);
$("btn-close-api-settings")?.addEventListener("click", () => $("api-settings-modal").hidden = true);
$("api-settings-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const g = $("key-google").value.trim();
  const a = $("key-anthropic").value.trim();
  if (g) localStorage.setItem(KEY_GOOGLE, g); else localStorage.removeItem(KEY_GOOGLE);
  if (a) localStorage.setItem(KEY_ANTHROPIC, a); else localStorage.removeItem(KEY_ANTHROPIC);
  $("api-settings-status").textContent = "✓ 保存しました";
  setTimeout(() => $("api-settings-modal").hidden = true, 800);
});
$("btn-clear-keys")?.addEventListener("click", () => {
  localStorage.removeItem(KEY_GOOGLE); localStorage.removeItem(KEY_ANTHROPIC);
  $("key-google").value = ""; $("key-anthropic").value = "";
});

// ─── 描画ヘルパー ───────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function truncate(s, n=50) { s=String(s??""); return s.length>n? s.slice(0,n)+"…" : s; }
function priorityBadge(p) {
  if (!p || p==="☆☆☆") return '<span class="pri pri-0">☆☆☆</span>';
  if (p==="★★★") return '<span class="pri pri-3">★★★</span>';
  if (p==="★★☆") return '<span class="pri pri-2">★★☆</span>';
  return '<span class="pri pri-1">★☆☆</span>';
}
function renderRows(rows) {
  const tbody = $("results-body");
  if (!rows || rows.length===0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="9"><div class="empty-state"><h3>該当企業なし</h3><p>キーワード・エリアを変えて試してください</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const emails = (r.emails || "").split(";").filter(Boolean);
    const emailHtml = emails.length>0
      ? `<a href="mailto:${escapeHtml(emails[0])}">${escapeHtml(emails[0])}</a>${emails.length>1?` <small>+${emails.length-1}</small>`:""}`
      : '<span class="badge no">—</span>';
    return `
      <tr class="${r.priority==="★★★"?"row-p3":(r.priority==="★★☆"?"row-p2":"")}">
        <td>${priorityBadge(r.priority)}</td>
        <td><span class="rev-tag">${escapeHtml(r.revenue_rank || "—")}</span></td>
        <td><span class="rev-tag">${escapeHtml(r.category || "—")}</span></td>
        <td class="cell-name">${escapeHtml(r.name)}</td>
        <td class="cell-addr">${escapeHtml(truncate(r.address,40))}</td>
        <td class="cell-phone">${escapeHtml(r.phone || "—")}</td>
        <td class="cell-web">${r.website?`<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener">${escapeHtml(truncate(r.website.replace(/^https?:\/\//,""),24))}</a>`:"—"}</td>
        <td class="cell-email">${emailHtml}</td>
        <td class="cell-reason">${escapeHtml(truncate(r.reason || "",80))}</td>
      </tr>
    `;
  }).join("");
}

// ─── テキスト → 配列 (カンマ・改行区切り) ──
function splitFreeText(s) {
  return (s || "")
    .split(/[,、\n\r]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// ─── Submit ───────────────────────────────
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKeys = getStoredKeys();
  if (!apiKeys.google_maps) {
    $("status").textContent = "Google Maps API キー未設定";
    openApiSettings();
    return;
  }
  const keywords = splitFreeText($("f-keywords-free").value);
  const excludeMajors = splitFreeText($("f-exclude-free").value);
  if (keywords.length === 0) {
    $("status").textContent = "業界キーワードを1つ以上入力してください"; return;
  }

  // 入力内容を保存
  localStorage.setItem(KEY_LAST_KW, $("f-keywords-free").value);
  localStorage.setItem(KEY_LAST_EXCLUDE, $("f-exclude-free").value);

  const property = {
    name: `業界検索: ${keywords.slice(0,3).join("/")}${keywords.length>3?"他":""}`,
    address: "",
    hook: excludeMajors.length > 0
      ? `業界エマージング企業の発掘。除外: ${excludeMajors.slice(0,5).join("、")}など${excludeMajors.length}社`
      : `業界候補企業の発掘`,
    areas: chips.length > 0 ? chips : ["全国"],
  };
  const options = {
    enrichWithAi: $("f-enrich-ai").checked,
    scrape: $("f-scrape").checked,
    excludeCompanies: excludeMajors,
    industryMode: true,
    language: "ja", region: "JP",
    searchMode: "area",
  };

  const btn = $("btn-search");
  btn.disabled = true;
  btn.querySelector(".btn-spinner").hidden = false;
  btn.querySelector(".btn-label").textContent = "生成中...";
  $("status").textContent = `Phase 1: Google Maps を検索中... (${keywords.length}キーワード × ${chips.length || 1}エリア)`;
  $("btn-csv").hidden = true;

  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property, keywords, apiKeys, options }),
    });
    const data = await r.json();
    if (!data.ok) {
      if (data.needApiKey) openApiSettings();
      throw new Error(data.error || "unknown error");
    }
    renderRows(data.rows);
    let countText = `${data.counts.returned}社（元データ ${data.counts.found}社）`;
    if (data.counts.truncated) countText += `  ※上位${data.counts.cap}件に絞込（検索語やエリアを増やすと網羅性UP）`;
    const costParts = [];
    if (data.maps_usage) costParts.push(`Google Maps: $${data.maps_usage.cost_usd.toFixed(3)}（≈¥${data.maps_usage.cost_jpy} / ${data.maps_usage.request_count}リク）`);
    if (data.claude_usage) {
      const u = data.claude_usage;
      const c = u.cost_usd < 0.001 ? `$${(u.cost_usd*1000).toFixed(2)}m` : `$${u.cost_usd.toFixed(4)}`;
      costParts.push(`Claude: ${c}（≈¥${u.cost_jpy}）`);
    }
    if (costParts.length) countText += `  ―  ${costParts.join(" + ")}`;
    $("results-count").textContent = countText;
    lastCsvBase64 = data.csv_base64;
    $("btn-csv").hidden = false;
    $("status").textContent = `✓ ${data.counts.returned}社のリストを生成`;
  } catch (err) {
    $("status").textContent = `エラー: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-spinner").hidden = true;
    btn.querySelector(".btn-label").textContent = "リスト生成";
  }
});

$("btn-csv").addEventListener("click", () => {
  if (!lastCsvBase64) return;
  const bin = atob(lastCsvBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `業界別検索_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Init: 前回の入力を復元
const lastKw = localStorage.getItem(KEY_LAST_KW);
const lastEx = localStorage.getItem(KEY_LAST_EXCLUDE);
if (lastKw) $("f-keywords-free").value = lastKw;
if (lastEx) $("f-exclude-free").value = lastEx;
if (!getStoredKeys().google_maps) setTimeout(openApiSettings, 400);
