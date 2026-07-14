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
    if (/not authorized to use this service|API restrictions|check the API restrictions/i.test(t)) hint = "（キーの『APIの制限』に Maps Static API を追加してください。APIとサービス→認証情報→対象キー→APIの制限）";
    else if (/not activated|enable this API|REQUEST_DENIED|SERVICE_DISABLED|disabled/i.test(t)) hint = "（Google Cloud で『Maps Static API』を有効化してください）";
    else if (/keyInvalid|API key not valid/i.test(t)) hint = "（Google Maps APIキーが正しくありません）";
    else if (/referer|referrer|HTTP_REFERRER/i.test(t)) hint = "（キーのHTTPリファラー制限を解除/IP制限に変更してください）";
    throw new Error(`航空写真の取得に失敗${hint}: ${resp.status} ${t.slice(0, 150)}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString("base64");
}

function buildVisionPrompt() {
  return `この画像はある地域の航空写真（衛星画像、真上から）です。
この中から「倉庫・物流施設・工場のような大きな屋根」を持つ建物だけを見つけてください。

■ 倉庫っぽい屋根の特徴（すべて当てはまるほど確信度を上げる）:
- 大きくて平らな長方形（または角ばった）の屋根。白〜灰色の金属屋根が多い
- 屋根が一枚のまとまりとして連続している（住宅街のように小屋根が密集していない）
- 周囲にトラックバース（大型車の接車スペース）・大型駐車場・舗装ヤード・コンテナがある

■ 倉庫ではない。必ず除外する（confidenceを付けず結果に含めない）:
- 一般住宅・アパート・マンション（小さい屋根の集まり、ベランダ、密集した住宅街）
- 商業施設・ショッピングモール・大型店舗の屋上駐車場（立体駐車場のスロープ・区画線）
- 学校・体育館・グラウンド・スタジアム・プール
- 太陽光パネル（規則的な黒い格子模様のみで建物ではないもの）
- 農地・ビニールハウス（透明〜白の連棟、畝が見える）
- 単なる駐車場・空き地・造成地（建物の屋根が無いもの）

■ bbox は屋根の輪郭にできるだけ密着させる（周囲の地面・道路・駐車場を含めない）。
■ confidence は正直に付ける。倉庫だと確信できないもの（住宅かも/店舗かも）は 0.5 未満にする。

厳密なJSON配列のみ返す（前置き・コードフェンス不要）。各要素:
{
  "bbox": [x0, y0, x1, y1],   // 0〜1の小数。x0<x1, y0<y1。屋根の輪郭に密着
  "confidence": 0.0〜1.0,      // 倉庫らしさの確信度（迷ったら低め）
  "note": "色・形・トラックバース/コンテナ有無など一言"
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

// 倉庫の入居者として「刺さる」業種タイプ（近傍事業者の絞り込みに使う）
const RELEVANT_TYPES = new Set([
  "warehouse", "storage", "moving_company", "logistics", "shipping_service",
  "corporate_office", "general_contractor", "factory", "wholesaler", "distribution_center",
]);
// 屋根の入居者としてあり得ない/ノイズになりやすいタイプ（除外）
const NOISE_TYPES = new Set([
  "parking", "bus_station", "transit_station", "train_station", "subway_station",
  "route", "street_address", "premise", "intersection", "political",
  "restaurant", "cafe", "convenience_store", "atm", "bus_stop",
]);

// 屋根中心の近傍から、倉庫の入居者らしい事業者を1件推定する。
// 半径を段階的に広げつつ複数候補を取得し、業種タイプで採点して最良を選ぶ。
async function nearbyBusiness({ lat, lng, apiKey, radius = 60 }) {
  try {
    const r = await fetch(NEARBY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.googleMapsUri,places.id,places.types",
      },
      body: JSON.stringify({
        languageCode: "ja", maxResultCount: 8, rankPreference: "DISTANCE",
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
    });
    const d = await r.json();
    const places = d.places || [];
    if (places.length === 0) return null;

    // 採点: 関連タイプ +2 / ノイズタイプ -3 / 名前に物流系ワード +2。
    // 順序（DISTANCE）を弱いタイブレークに使う（近いほど僅かに有利）。
    const NAME_HINT = /(物流|運輸|ロジ|流通|倉庫|センター|運送|急便|通運|梱包|配送|ロジスティ)/;
    const scored = places.map((p, idx) => {
      const types = p.types || [];
      let score = -idx * 0.1;
      if (types.some((t) => RELEVANT_TYPES.has(t))) score += 2;
      if (types.some((t) => NOISE_TYPES.has(t))) score -= 3;
      const name = p.displayName?.text || "";
      if (NAME_HINT.test(name)) score += 2;
      if (!name) score -= 2;
      return { p, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    // ノイズしか無い（最良でもマイナス）なら名称特定を諦め、逆ジオコーディングに委ねる
    if (!best || best.score < 0) return null;
    const p = best.p;
    return { name: p.displayName?.text || "", maps_url: p.googleMapsUri || "", place_id: p.id || "", address: p.formattedAddress || "" };
  } catch {}
  return null;
}

export async function scanRoofs({ apiKey, anthropicKey, lat, lng, zoom = 17, minAreaSqm = 1000, minConfidence = 0.5, sizePx = 640, scale = 2 }) {
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
    // 確信度フィルタ: 倉庫だと言い切れない検出（住宅/店舗の誤検出）を落とす
    const conf = typeof d.confidence === "number" ? d.confidence : null;
    if (conf != null && conf < minConfidence) continue;
    const wM = (x1 - x0) * coverage;
    const hM = (y1 - y0) * coverage;
    // 細長すぎる矩形（道路・水路・畝などの誤検出）を除外。倉庫の縦横比は概ね12倍以内
    const longSide = Math.max(wM, hM), shortSide = Math.min(wM, hM);
    if (shortSide > 0 && longSide / shortSide > 12) continue;
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
