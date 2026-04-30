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

function setBusy(isBusy) {
  btn.disabled = isBusy;
  spinner.hidden = !isBusy;
  btnLabel.textContent = isBusy ? "生成中..." : "リスト生成";
}
function setStatus(msg, type = "") {
  status.textContent = msg;
  status.className = "status " + type;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function truncate(s, n = 50) {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || "unknown error");
    renderRows(data.rows);
    resultsCount.textContent = `${data.count}件`;
    lastCsvBase64 = data.csv_base64;
    lastQuery = data.query;
    btnCsv.hidden = false;
    setStatus(`✓ ${data.count}件のリストを生成しました`, "success");
  } catch (err) {
    setStatus(`エラー: ${err.message}`, "error");
    tbody.innerHTML = `<tr class="empty"><td colspan="7">エラーが発生しました: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    setBusy(false);
  }
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
