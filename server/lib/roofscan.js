// 航空写真（Google Static Maps 衛星）から倉庫っぽい大屋根を Claude Vision で検出し、
// 各屋根の緯度経度・推定面積・Googleマップ情報を返す。BYOK（Google Maps + Anthropic）。

const STATIC_URL = "https://maps.googleapis.com/maps/api/staticmap";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const VISION_MODEL = "claude-sonnet-4-6"; // Vision対応・最新Sonnet
const PRICE_INPUT = 3 / 1_000_000;
const PRICE_OUTPUT = 15 / 1_000_000;

// Web Mercator: ズーム z・緯度 lat における 1ピクセルの地上メートル（scale=1基準）
function baseMetersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

// 衛星画像を取得して base64(PNG) を返す。size=640×scale2 = 1280px相当。
async function fetchSatellite({ lat, lng, zoom, apiKey, sizePx = 640, scale = 2 }) {
  const url = `${STATIC_URL}?center=${lat},${lng}&zoom=${zoom}&size=${sizePx}x${sizePx}&scale=${scale}&maptype=satellite&format=png&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const t = await resp.text();
    let hint = "";
    if (/not authorized|REQUEST_DENIED|disabled/i.test(t)) hint = "（Google Cloud で『Maps Static API』を有効化してください）";
    else if (/keyInvalid|API key/i.test(t)) hint = "（Google Maps APIキーが正しくありません）";
    throw new Error(`航空写真の取得に失敗${hint}: ${resp.status} ${t.slice(0, 150)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

function buildVisionPrompt() {
  return `この画像はある地域の航空写真（衛星画像、真上から）です。
この中から「倉庫・物流施設・工場のような大きな屋根」を持つ建物をすべて見つけてください。

倉庫っぽい屋根の特徴:
- 大きくて平らな長方形（または角ばった）の屋根
- 白〜灰色、金属屋根のことが多い
- 周囲にトラックバース・大型駐車場・舗装ヤードがある
- 一般住宅や小さな建物は除外（大きい建物のみ）

各建物について、画像内の位置を「左上を(0,0)・右下を(1,1)とした割合」で囲む矩形(bbox)で返してください。

厳密なJSON配列のみ返す（前置き・コードフェンス不要）。各要素:
{
  "bbox": [x0, y0, x1, y1],   // 0〜1の小数。x0<x1, y0<y1
  "confidence": 0.0〜1.0,      // 倉庫らしさの確信度
  "note": "色・形・トラックバース有無など一言"
}
倉庫っぽい大屋根が無ければ [] を返す。最大25件。`;
}

async function callVision({ apiKey, imageB64, mediaType = "image/png" }) {
  const body = {
    model: VISION_MODEL,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
        { type: "text", text: buildVisionPrompt() },
      ],
    }],
  };
  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Claude Vision ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return { text: data.content?.[0]?.text || "", usage: data.usage || {} };
}

function parseJsonArray(text) {
  let s = (text || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a < 0 || b < 0) return [];
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return []; }
}

// 画像内の割合座標(fx,fy: 0-1) → 緯度経度（中心 lat0,lng0、640px相当のカバレッジ）
function fracToLatLng(fx, fy, lat0, lng0, zoom, sizePx) {
  const bmpp = baseMetersPerPixel(lat0, zoom);
  const coverage = sizePx * bmpp; // 画像が表す地上の幅（メートル）
  const dxM = (fx - 0.5) * coverage;            // 東方向(+)
  const dyM = (fy - 0.5) * coverage;            // 南方向(+)（yは下向き）
  const dLat = -(dyM) / 111_320;
  const dLng = dxM / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  return { lat: lat0 + dLat, lng: lng0 + dLng };
}

async function reverseGeocode({ lat, lng, apiKey }) {
  try {
    const r = await fetch(`${GEOCODE_URL}?latlng=${lat},${lng}&language=ja&key=${apiKey}`);
    const d = await r.json();
    if (d.status === "OK" && d.results?.[0]) {
      return { address: d.results[0].formatted_address.replace(/^日本、?/, "") };
    }
  } catch {}
  return { address: "" };
}

async function nearbyBusiness({ lat, lng, apiKey, radius = 45 }) {
  try {
    const r = await fetch(NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.googleMapsUri,places.id,places.types",
      },
      body: JSON.stringify({
        languageCode: "ja", maxResultCount: 1, rankPreference: "DISTANCE",
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
    });
    const d = await r.json();
    const p = d.places?.[0];
    if (p) return { name: p.displayName?.text || "", maps_url: p.googleMapsUri || "", place_id: p.id || "", address: p.formattedAddress || "" };
  } catch {}
  return null;
}

export async function scanRoofs({ apiKey, anthropicKey, lat, lng, zoom = 17, minAreaSqm = 1000, sizePx = 640, scale = 2 }) {
  if (!anthropicKey) throw new Error("航空写真の屋根検出には Anthropic Claude API キーが必要です（API設定から登録）");
  const imageB64 = await fetchSatellite({ lat, lng, zoom, apiKey, sizePx, scale });
  const { text, usage } = await callVision({ apiKey: anthropicKey, imageB64 });
  const dets = parseJsonArray(text);

  const bmpp = baseMetersPerPixel(lat, zoom);
  const coverage = sizePx * bmpp; // meters across full image
  const roofs = [];
  for (const d of dets) {
    const bb = d.bbox;
    if (!Array.isArray(bb) || bb.length !== 4) continue;
    let [x0, y0, x1, y1] = bb.map(Number);
    if (![x0, y0, x1, y1].every((n) => Number.isFinite(n))) continue;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    const wM = (x1 - x0) * coverage;
    const hM = (y1 - y0) * coverage;
    const areaSqm = Math.round(wM * hM);
    if (areaSqm < minAreaSqm) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const { lat: rlat, lng: rlng } = fracToLatLng(cx, cy, lat, lng, zoom, sizePx);
    roofs.push({
      bbox: [x0, y0, x1, y1],
      area_sqm: areaSqm,
      area_tsubo: Math.round(areaSqm / 3.30579),
      lat: +rlat.toFixed(6), lng: +rlng.toFixed(6),
      confidence: typeof d.confidence === "number" ? d.confidence : null,
      note: d.note || "",
    });
  }
  // 大きい順
  roofs.sort((a, b) => b.area_sqm - a.area_sqm);

  // 各屋根の Googleマップ情報を取得（逆ジオコーディング＋近傍事業者）
  for (const r of roofs) {
    const nb = await nearbyBusiness({ lat: r.lat, lng: r.lng, apiKey });
    const rev = await reverseGeocode({ lat: r.lat, lng: r.lng, apiKey });
    r.name = nb?.name || "(名称不明・要現地確認)";
    r.address = nb?.address?.replace(/^日本、?/, "") || rev.address || "";
    r.maps_url = nb?.maps_url || `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;
    r.place_id = nb?.place_id || "";
  }

  const costUsd = (usage.input_tokens || 0) * PRICE_INPUT + (usage.output_tokens || 0) * PRICE_OUTPUT;
  return {
    image_b64: imageB64,
    image_size_px: sizePx * scale,
    coverage_m: Math.round(coverage),
    center: { lat, lng },
    zoom,
    roofs,
    claude_usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_usd: costUsd,
      cost_jpy: Math.round(costUsd * 150),
    },
  };
}
