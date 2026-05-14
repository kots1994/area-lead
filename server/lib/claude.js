// Claude API enrichment — BYOK
// Sends candidate rows (max ~30 per batch) and asks Claude to rate priority
// and infer revenue rank + reason in structured JSON.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";
const MAX_RETRIES = 2;

function buildPrompt({ property, rows }) {
  const lines = rows.map((r, i) => {
    return `${i + 1}. ${r.name} | ${r.address || ""} | website: ${r.website || "なし"}`;
  }).join("\n");
  return `
あなたは倉庫テナント営業のリスト整理を補助するアシスタントです。

【物件情報】
- 物件名: ${property.name}
- 立地: ${property.address}
- 対象エリア: ${(property.areas || []).join("、")}
- 物件のフック: ${property.hook || "(未指定)"}

【候補企業リスト】
${lines}

【タスク】
各企業について以下を判定し、JSON配列で返してください（${rows.length}件分、入力順を維持）:

- priority: ★★★ (最優先 = 既存拠点が対象エリア至近 + 拡張ニュースあり + 売上規模大) /
            ★★☆ (優先 = 周辺エリアに拠点 + 売上10億+) /
            ★☆☆ (標準) /
            ☆☆☆ (低)
- revenue_rank: "5億未満" / "5-10億" / "10-30億" / "30-100億" / "100億+" / "不明"
- category: "3PL" / "EC物流" / "食品物流" / "製造業物流" / "一般運送" / "その他"
- reason: 物件のフックを活かしてなぜ刺さるか（80字以内）
- estimated_department: 推定担当部署（"物流統括部" "管理部" 等、80字以内）
- chinese_or_ec_emerging: 中国系/EC新興物流企業かどうか（boolean、不明ならfalse）

知らない企業は推定でOK、ただし不明と書ける項目は "不明" を返す。
JSON配列のみ返してください。コードフェンスや前置きは不要。
`;
}

async function callClaude({ apiKey, prompt }) {
  const body = {
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  };
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 250)}`);
      }
      const data = await resp.json();
      return data.content?.[0]?.text || "";
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("Claude API unknown error");
}

function parseJsonArray(text) {
  // Strip code fences if any
  let s = text.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  }
  // Find array brackets
  const first = s.indexOf("[");
  const last = s.lastIndexOf("]");
  if (first < 0 || last < 0) return [];
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return [];
  }
}

/**
 * Enrich rows in batches. Returns the same row list with extra fields:
 *  priority, revenue_rank, category, reason, estimated_department, chinese_or_ec_emerging
 */
export async function enrichWithClaude({ apiKey, property, rows, batchSize = 25, onProgress }) {
  const out = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const prompt = buildPrompt({ property, rows: batch });
    let answers = [];
    try {
      const text = await callClaude({ apiKey, prompt });
      answers = parseJsonArray(text);
    } catch (e) {
      console.warn(`[Claude] batch ${i} failed: ${e.message}`);
    }
    for (let j = 0; j < batch.length; j++) {
      const a = answers[j] || {};
      out.push({
        ...batch[j],
        priority: a.priority || "☆☆☆",
        revenue_rank: a.revenue_rank || "不明",
        category: a.category || "その他",
        reason: a.reason || "",
        estimated_department: a.estimated_department || "",
        chinese_or_ec_emerging: !!a.chinese_or_ec_emerging,
      });
    }
    if (onProgress) onProgress(out.length, rows.length);
  }
  // Sort by priority (★★★ first)
  const rank = { "★★★": 3, "★★☆": 2, "★☆☆": 1, "☆☆☆": 0 };
  out.sort((a, b) => (rank[b.priority] || 0) - (rank[a.priority] || 0));
  return out;
}
