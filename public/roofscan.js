// 航空写真から倉庫っぽい屋根を検出してリスト化
const $ = (id) => document.getElementById(id);

const KEY_GOOGLE = "al.key.google";
const KEY_ANTHROPIC = "al.key.anthropic";
const KEY_GCLIENT = "al.key.gclient";
const KEY_SHEET = "al.sheet.id";
const DEFAULT_GCLIENT = "83180101815-b5j1399jb6j0qo4pkbl8pucg2j881jve.apps.googleusercontent.com";

let lastRoofs = null;
let lastCenter = null;

function getStoredKeys() {
  return {
    google_maps: localStorage.getItem(KEY_GOOGLE) || "",
    anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
  };
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
function setStatus(msg, type = "") { const s = $("status"); s.textContent = msg; s.className = "status " + type; }

// ─── API設定モーダル ───
function openApiSettings() {
  const k = getStoredKeys();
  $("key-google").value = k.google_maps;
  $("key-anthropic").value = k.anthropic;
  $("key-sheet").value = localStorage.getItem(KEY_SHEET) || "";
  $("api-settings-modal").hidden = false;
}
$("btn-open-api-settings")?.addEventListener("click", openApiSettings);
$("btn-close-api-settings")?.addEventListener("click", () => ($("api-settings-modal").hidden = true));
$("api-settings-modal")?.addEventListener("click", (e) => { if (e.target.id === "api-settings-modal") $("api-settings-modal").hidden = true; });
$("api-settings-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const g = $("key-google").value.trim(), a = $("key-anthropic").value.trim(), sh = $("key-sheet").value.trim();
  if (g) localStorage.setItem(KEY_GOOGLE, g); else localStorage.removeItem(KEY_GOOGLE);
  if (a) localStorage.setItem(KEY_ANTHROPIC, a); else localStorage.removeItem(KEY_ANTHROPIC);
  if (sh) localStorage.setItem(KEY_SHEET, sh); else localStorage.removeItem(KEY_SHEET);
  $("api-settings-status").textContent = "✓ 保存しました";
  $("api-settings-status").className = "modal-status success";
  setTimeout(() => ($("api-settings-modal").hidden = true), 800);
});
$("btn-clear-keys")?.addEventListener("click", () => {
  [KEY_GOOGLE, KEY_ANTHROPIC, KEY_SHEET].forEach((k) => localStorage.removeItem(k));
  $("key-google").value = ""; $("key-anthropic").value = ""; $("key-sheet").value = "";
});

// ─── ズーム表示 ───
$("f-zoom").addEventListener("input", () => { $("zoom-val").textContent = $("f-zoom").value; });

// ─── 描画 ───
function renderResults(data) {
  lastRoofs = data.roofs;
  lastCenter = data.center;
  const stage = $("roof-stage");
  const roofs = data.roofs || [];
  // 画像 + 枠
  stage.innerHTML = `<img id="roof-img" src="data:image/png;base64,${data.image_b64}" alt="航空写真">`;
  const boxes = roofs.map((r, i) => {
    const [x0, y0, x1, y1] = r.bbox;
    const l = (x0 * 100).toFixed(2), t = (y0 * 100).toFixed(2);
    const w = ((x1 - x0) * 100).toFixed(2), h = ((y1 - y0) * 100).toFixed(2);
    return `<div class="roof-box" data-i="${i}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%">
      <span class="roof-tag">${i + 1}</span></div>`;
  }).join("");
  stage.insertAdjacentHTML("beforeend", boxes);

  // テーブル
  const tbody = $("results-body");
  if (roofs.length === 0) {
    tbody.innerHTML = `<tr class="empty"><td colspan="6"><div class="empty-state"><h3>倉庫っぽい大屋根は見つかりませんでした</h3><p>ズームを下げる/最小面積を下げて再試行してください。</p></div></td></tr>`;
  } else {
    tbody.innerHTML = roofs.map((r, i) => {
      const conf = r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—";
      return `<tr class="roof-row" data-i="${i}">
        <td><strong>${i + 1}</strong></td>
        <td>${r.area_sqm.toLocaleString()}㎡<br><span style="color:#64748b">≈${r.area_tsubo.toLocaleString()}坪</span></td>
        <td>${escapeHtml(r.name)}</td>
        <td style="font-size:12px">${escapeHtml(r.address)}</td>
        <td>${conf}</td>
        <td><a href="${escapeHtml(r.maps_url)}" target="_blank" rel="noopener">地図↗</a></td>
      </tr>`;
    }).join("");
  }

  // ハイライト連動
  stage.querySelectorAll(".roof-box").forEach((b) => b.addEventListener("click", () => highlight(+b.dataset.i)));
  tbody.querySelectorAll(".roof-row").forEach((tr) => tr.addEventListener("click", () => highlight(+tr.dataset.i)));

  let countText = `${roofs.length}件の倉庫候補（解析範囲 一辺約${data.coverage_m}m / ズーム${data.zoom}）`;
  if (data.claude_usage) countText += `  ―  Claude: $${data.claude_usage.cost_usd.toFixed(4)}（≈¥${data.claude_usage.cost_jpy}）`;
  $("results-count").textContent = countText;
  $("btn-sheet").hidden = roofs.length === 0;
  $("btn-csv").hidden = roofs.length === 0;
}
function highlight(i) {
  document.querySelectorAll(".roof-box").forEach((b) => b.classList.toggle("sel", +b.dataset.i === i));
  document.querySelectorAll(".roof-row").forEach((r) => r.classList.toggle("sel", +r.dataset.i === i));
  const row = document.querySelector(`.roof-row[data-i="${i}"]`);
  if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setBusy(b) {
  $("btn-scan").disabled = b;
  $("btn-scan").querySelector(".btn-spinner").hidden = !b;
  $("btn-scan").querySelector(".btn-label").textContent = b ? "解析中..." : "航空写真を解析";
}

// ─── 解析実行 ───
$("scan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const keys = getStoredKeys();
  if (!keys.google_maps || !keys.anthropic) {
    setStatus("Google Maps と Anthropic Claude のキーが必要です（API設定）", "error");
    openApiSettings();
    return;
  }
  const center = $("f-center").value.trim();
  if (!center) { setStatus("中心地点を入力してください", "error"); return; }
  // ピン(座標/URL)か住所か判定して送る
  const isPin = /^https?:\/\//.test(center) || /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(center);
  const body = {
    apiKeys: { google_maps: keys.google_maps, anthropic: keys.anthropic },
    center: isPin ? { pin: center } : { address: center },
    zoom: +$("f-zoom").value,
    minAreaSqm: +$("f-minarea").value || 0,
  };
  setBusy(true);
  setStatus("航空写真を取得して Claude が解析中...", "info");
  $("btn-sheet").hidden = true; $("btn-csv").hidden = true;
  try {
    const r = await fetch("/api/roofscan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.ok) { if (data.needApiKey) openApiSettings(); throw new Error(data.error || "解析に失敗しました"); }
    renderResults(data);
    setStatus(`✓ ${data.roofs.length}件の倉庫候補を検出しました`, "success");
  } catch (err) {
    setStatus(`エラー: ${err.message}`, "error");
  } finally { setBusy(false); }
});

// ─── CSV ───
$("btn-csv").addEventListener("click", () => {
  if (!lastRoofs?.length) return;
  const cols = ["#", "推定面積_㎡", "推定面積_坪", "名称(近傍)", "住所", "緯度", "経度", "確信度", "備考", "MapsURL"];
  const rows = lastRoofs.map((r, i) => [i + 1, r.area_sqm, r.area_tsubo, r.name, r.address, r.lat, r.lng,
    r.confidence != null ? Math.round(r.confidence * 100) + "%" : "", r.note, r.maps_url]);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [cols, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `倉庫候補_航空写真_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
});

// ─── Google Sheet 出力（GIS） ───
function parseSpreadsheetId(input) {
  const m = String(input || "").match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(String(input || "").trim())) return input.trim();
  return null;
}
let gisToken = null;
function getSheetsToken(clientId) {
  return new Promise((resolve, reject) => {
    if (gisToken && gisToken.expires_at > Date.now() + 60000) return resolve(gisToken.access_token);
    if (!window.google?.accounts?.oauth2) return reject(new Error("Google認証ライブラリの読込待ちです。数秒後に再試行を"));
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: "https://www.googleapis.com/auth/spreadsheets",
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
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || `Sheets API ${r.status}`);
  return data;
}
$("btn-sheet").addEventListener("click", async () => {
  if (!lastRoofs?.length) return;
  const clientId = localStorage.getItem(KEY_GCLIENT) || DEFAULT_GCLIENT;
  const sheetId = parseSpreadsheetId(localStorage.getItem(KEY_SHEET) || "");
  if (!sheetId) { setStatus("Sheet出力には「API設定」で 出力先スプレッドシート の設定が必要です", "error"); openApiSettings(); return; }
  $("btn-sheet").disabled = true;
  try {
    setStatus("Googleアカウントで認可中...", "info");
    const token = await getSheetsToken(clientId);
    const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
    const base = `倉庫候補_${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    let title = base, added = null;
    for (let i = 0; i < 3; i++) {
      try {
        added = await sheetsApi(token, "POST", `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
          { requests: [{ addSheet: { properties: { title } } }] });
        break;
      } catch (e) { if (/already exists/i.test(e.message)) { title = `${base}_${i + 2}`; continue; } throw e; }
    }
    const gid = added?.replies?.[0]?.addSheet?.properties?.sheetId;
    const header = ["#", "推定面積_㎡", "推定面積_坪", "名称(近傍)", "住所", "緯度", "経度", "確信度", "備考", "MapsURL"];
    const values = [header, ...lastRoofs.map((r, i) => [i + 1, r.area_sqm, r.area_tsubo, r.name, r.address, r.lat, r.lng,
      r.confidence != null ? Math.round(r.confidence * 100) + "%" : "", r.note, r.maps_url])];
    await sheetsApi(token, "PUT",
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=USER_ENTERED`,
      { values });
    const link = `https://docs.google.com/spreadsheets/d/${sheetId}/edit${gid != null ? `#gid=${gid}` : ""}`;
    $("status").className = "status success";
    $("status").innerHTML = `✓ Sheetにタブ「${escapeHtml(title)}」を追加しました（${lastRoofs.length}件） <a href="${link}" target="_blank" rel="noopener">開く →</a>`;
  } catch (err) {
    setStatus(`Sheet出力エラー: ${err.message}`, "error");
  } finally { $("btn-sheet").disabled = false; }
});

// Init
(() => { if (!getStoredKeys().google_maps) setTimeout(openApiSettings, 400); })();
