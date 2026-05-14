// Claude API — 営業リード reason テキストの AI 添削 / 仕分け補助

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5";

async function callClaude({ apiKey, prompt, maxTokens = 1500 }) {
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 250)}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || "";
}

/**
 * AI 添削: 営業向けの「候補理由」テキストや「メール本文」テキストを
 * style（"polite" / "concise" / "friendly"）に変換する。
 */
export async function polishText({ apiKey, text, style = "polite", purpose = "reason" }) {
  if (!text || !text.trim()) return "";
  const styleMap = {
    polite: "丁寧でフォーマルな文体に。敬語と丁寧語を徹底し、相手に礼を尽くす表現にしてください。",
    concise: "簡潔に。冗長な表現を削り、要点だけを3〜5行にまとめてください。",
    friendly: "親しみやすく。堅すぎず、自然な会話調で、相手との距離を近づける表現にしてください。",
  };
  const purposeMap = {
    reason: "この文章は『なぜこの企業が物件のテナント候補として有力か』を1〜2文で説明するものです。",
    body: "この文章は B2B 営業の初回コンタクトメール本文です。署名や宛名は含めず、本文だけを返してください。",
  };
  const prompt = `${purposeMap[purpose] || ""}

${styleMap[style] || styleMap.polite}

【元の文章】
${text}

【出力ルール】
- 元の文章の意図と事実関係は維持
- 不要な前置きやコードフェンスは一切付けない
- 添削後の文章のみを返す`;
  return await callClaude({ apiKey, prompt, maxTokens: 1500 });
}
