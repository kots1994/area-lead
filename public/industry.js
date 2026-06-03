// 業種別エマージング検索
const $ = (id) => document.getElementById(id);

// ─── 業種カテゴリ定義 ───────────────────────
const CATEGORIES = [
  {
    id: "lease",
    label: "🏗 リース",
    keywords: ["レンタル", "リース", "建機レンタル", "機械レンタル", "工事用機材レンタル", "イベント機材レンタル"],
    majors: ["SMFL", "三菱HCキャピタル", "三共リース", "日建リース", "ニッケン", "アクティオ", "西尾", "コマツレンタル"],
  },
  {
    id: "welfare",
    label: "♿ 福祉用具",
    keywords: ["福祉用具", "介護用品", "介護機器", "福祉用具レンタル", "介護用品レンタル", "介護ベッド"],
    majors: ["ヤマシタ", "ニシケン", "フランスベッド", "ダスキンヘルスレント", "パナソニックエイジフリー"],
  },
  {
    id: "beverage",
    label: "🥤 飲料",
    keywords: ["飲料", "清涼飲料", "ミネラルウォーター", "飲料卸", "酒類卸", "酒販", "ジュース製造", "ボトリング"],
    majors: ["ダイドードリンコ", "アサヒ飲料", "日本酒類販売", "カクヤス", "伊藤園", "コカ・コーラ", "サントリー", "キリン", "ポッカサッポロ"],
  },
  {
    id: "construction-material",
    label: "🧱 建材",
    keywords: ["建材", "住宅建材", "建材販売", "建材商社", "建材卸", "サッシ", "外装材"],
    majors: ["LIXIL", "YKK AP", "TOTO", "大建工業", "ジューテック", "ナイス"],
  },
  {
    id: "construction-machine",
    label: "🚧 建機",
    keywords: ["建設機械", "建機販売", "重機販売", "建設機材"],
    majors: ["コマツ", "日立建機", "キャタピラー", "コベルコ建機"],
  },
  {
    id: "ec-logistics",
    label: "📦 EC物流",
    keywords: ["EC物流", "フルフィルメント", "通販物流", "越境EC", "EC配送"],
    majors: ["ヤマト運輸", "佐川急便", "日本郵便"],
  },
  {
    id: "food-wholesale",
    label: "🍱 食品卸",
    keywords: ["食品卸", "食品商社", "業務用食品", "冷凍食品卸", "青果卸"],
    majors: ["三菱食品", "日本アクセス", "国分", "加藤産業", "伊藤忠食品"],
  },
  {
    id: "apparel",
    label: "👕 アパレル",
    keywords: ["アパレル", "ファッション卸", "衣料品卸", "D2C アパレル"],
    majors: ["ユニクロ", "ファーストリテイリング", "しまむら", "ワールド", "オンワード"],
  },
  {
    id: "cosmetics",
    label: "💄 化粧品",
    keywords: ["化粧品", "コスメ", "化粧品卸", "美容商材", "D2C コスメ"],
    majors: ["資生堂", "コーセー", "花王", "ポーラ", "マンダム"],
  },
  {
    id: "pharma",
    label: "💊 医薬・ヘルスケア",
    keywords: ["医薬品卸", "医療機器", "ヘルスケア商品", "サプリメント"],
    majors: ["メディパル", "アルフレッサ", "スズケン", "東邦薬品"],
  },
  {
    id: "auto-parts",
    label: "🚗 自動車部品",
    keywords: ["自動車部品", "中古部品", "自動車部品商社", "カー用品"],
    majors: ["デンソー", "アイシン", "ブリヂストン", "オートバックス", "イエローハット"],
  },
  {
    id: "construction-3pl",
    label: "📋 一般物流/3PL",
    keywords: ["物流", "倉庫", "3PL", "ロジスティクス", "運輸", "運送"],
    majors: ["日本通運", "鴻池運輸", "センコー", "山九", "セイノー", "大和物流", "日立物流", "SBSロジ"],
  },
];

// ─── State ─────────────────────────────────
let selectedCategories = new Set();
let chips = [];
let lastCsvBase64 = null;

const KEY_GOOGLE = "al.key.google";
const KEY_ANTHROPIC = "al.key.anthropic";
function getStoredKeys() {
  return {
    google_maps: localStorage.getItem(KEY_GOOGLE) || "",
    anthropic: localStorage.getItem(KEY_ANTHROPIC) || "",
  };
}

// ─── カテゴリチップを描画 ───────────────────
function renderCategoryGrid() {
  $("category-grid").innerHTML = CATEGORIES.map((c) => `
    <label class="category-chip">
      <input type="checkbox" value="${c.id}" data-cat>
      <span class="category-chip-label">${c.label}</span>
    </label>
  `).join("");
  document.querySelectorAll("[data-cat]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedCategories.add(cb.value);
      else selectedCategories.delete(cb.value);
    });
  });
}

// ─── エリアchip入力 ───────────────────────
function renderChips() {
  $("chip-list").innerHTML = chips.map((a, i) => `
    <span class="chip">${a}<button type="button" data-idx="${i}">×</button></span>
  `).join("");
  $("f-areas").value = chips.join(",");
  document.querySelectorAll("[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      chips.splice(+btn.dataset.idx, 1); renderChips();
    });
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
    tbody.innerHTML = `<tr class="empty"><td colspan="9"><div class="empty-state"><h3>該当企業なし</h3><p>カテゴリ・エリアを変えて試してください</p></div></td></tr>`;
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

// ─── Submit ───────────────────────────────
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const apiKeys = getStoredKeys();
  if (!apiKeys.google_maps) {
    $("status").textContent = "Google Maps API キー未設定";
    openApiSettings();
    return;
  }
  if (selectedCategories.size === 0) {
    $("status").textContent = "業種カテゴリを1つ以上選択してください"; return;
  }

  // 選択カテゴリのキーワード・大手リストを統合
  const selectedCats = CATEGORIES.filter((c) => selectedCategories.has(c.id));
  const keywords = [...new Set(selectedCats.flatMap((c) => c.keywords))];
  const excludeMajors = $("f-exclude-majors").checked
    ? [...new Set(selectedCats.flatMap((c) => c.majors))]
    : [];

  // 仮想プロパティとしてエリア中心の検索を呼ぶ
  const property = {
    name: `業種検索: ${selectedCats.map((c) => c.label).join("/")}`,
    address: "",
    hook: `業種別エマージング企業の発掘。除外大手: ${excludeMajors.slice(0,5).join("、")}など`,
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
  $("status").textContent = "Phase 1: Google Maps を検索中...";
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
    const costParts = [];
    if (data.maps_usage) costParts.push(`Google Maps: $${data.maps_usage.cost_usd.toFixed(3)}（≈¥${data.maps_usage.cost_jpy} / ${data.maps_usage.request_count}リク）`);
    if (data.claude_usage) {
      const u = data.claude_usage;
      const c = u.cost_usd < 0.001 ? `$${(u.cost_usd*1000).toFixed(2)}m` : `$${u.cost_usd.toFixed(4)}`;
      costParts.push(`Claude: ${c}（≈¥${u.cost_jpy}）`);
    }
    if (costParts.length) countText += `  ―  💰 ${costParts.join(" + ")}`;
    $("results-count").textContent = countText;
    lastCsvBase64 = data.csv_base64;
    $("btn-csv").hidden = false;
    $("status").textContent = `✓ ${data.counts.returned}社のリストを生成`;
  } catch (err) {
    $("status").textContent = `エラー: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.querySelector(".btn-spinner").hidden = true;
    btn.querySelector(".btn-label").textContent = "📡 リスト生成";
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
  a.download = `業種別エマージング_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

// Init
renderCategoryGrid();
if (!getStoredKeys().google_maps) setTimeout(openApiSettings, 400);
