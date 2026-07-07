// Google Places API (New) wrapper — BYOK version

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.types",
  "places.businessStatus",
  "places.rating",
  "places.userRatingCount",
  "places.location",
].join(",");

async function textSearchOne({ query, languageCode, regionCode, apiKey, pageSize = 20, circle, pageToken }) {
  const body = { textQuery: query, languageCode, pageSize };
  if (regionCode) body.regionCode = regionCode;
  if (pageToken) body.pageToken = pageToken;
  if (circle) {
    // Places API (New) の locationRestriction は rectangle のみ対応（circle 不可）。
    // 中心＋半径から外接する矩形を作って絞り込む（厳密な円は後段で距離フィルタ）。
    const latDelta = circle.radiusMeters / 111_320; // 緯度1度 ≈ 111.32km
    const lngDelta = circle.radiusMeters / (111_320 * Math.cos((circle.lat * Math.PI) / 180));
    body.locationRestriction = {
      rectangle: {
        low: { latitude: circle.lat - latDelta, longitude: circle.lng - lngDelta },
        high: { latitude: circle.lat + latDelta, longitude: circle.lng + lngDelta },
      },
    };
  }
  const resp = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK + ",nextPageToken",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Places API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return { places: data.places || [], nextPageToken: data.nextPageToken || null };
}

export function normalizePlace(p) {
  return {
    place_id: p.id || "",
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    maps_url: p.googleMapsUri || "",
    types: (p.types || []).join(","),
    business_status: p.businessStatus || "",
    rating: p.rating || null,
    review_count: p.userRatingCount || 0,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
  };
}

/**
 * Run multiple queries (keyword × area combinations) and dedupe.
 * Optionally filter by company-name keywords.
 */
// Places API (New) Text Search pricing: $0.035 / request (Advanced Data SKU)
const PRICE_PER_REQUEST = 0.035;

// 2点間の距離（メートル）— 半径モードの厳密フィルタ用
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function searchTargets({ queries, languageCode = "ja", regionCode = "JP", apiKey, companyKeywords, circle, maxPagesPerQuery = 3 }) {
  const results = new Map();
  let requestCount = 0;
  let lastError = null;
  for (const q of queries) {
    // 1クエリあたり最大 maxPagesPerQuery ページ（20件×3=最大60件）をページネーションで取得
    let pageToken = null;
    for (let page = 0; page < maxPagesPerQuery; page++) {
      try {
        const { places, nextPageToken } = await textSearchOne({ query: q, languageCode, regionCode, apiKey, circle, pageToken });
        requestCount++;
        for (const p of places) {
          if (!p.id) continue;
          if (!results.has(p.id)) results.set(p.id, p);
        }
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        // 次ページトークンが有効になるまで少し待つ（Places API の仕様）
        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        lastError = e;
        console.warn(`[Places] query failed: "${q}" (page ${page}) → ${e.message}`);
        break;
      }
    }
  }
  // 全クエリが失敗（成功リクエスト0）なら握りつぶさず原因を表に出す。
  // ほぼ キー無効 / Places API (New) 未有効化 / キー制限 が原因。
  if (requestCount === 0 && queries.length > 0 && lastError) {
    const m = lastError.message || "";
    let hint = "";
    if (/API key not valid|API_KEY_INVALID/i.test(m)) hint = "（Google Maps APIキーが正しくありません）";
    else if (/SERVICE_DISABLED|has not been used|is disabled/i.test(m)) hint = "（Google Cloud で『Places API (New)』を有効化してください）";
    else if (/referer|referrer|HTTP_REFERRER/i.test(m)) hint = "（キーのHTTPリファラー制限を解除/IP制限に変更してください。サーバー側から呼ぶため）";
    throw new Error(`企業検索に失敗しました${hint}: ${m.slice(0, 200)}`);
  }
  let all = [...results.values()].map(normalizePlace);
  // 矩形で取得したので、厳密な円にするため中心からの実距離で絞り込む。
  if (circle) {
    all = all.filter((r) => {
      if (r.lat == null || r.lng == null) return true;
      return haversineMeters(circle.lat, circle.lng, r.lat, r.lng) <= circle.radiusMeters;
    });
  }
  let filtered = all;
  if (companyKeywords && companyKeywords.length > 0) {
    const lowered = companyKeywords.map((k) => k.toLowerCase());
    filtered = all.filter((r) => {
      const nl = (r.name || "").toLowerCase();
      return lowered.some((k) => nl.includes(k));
    });
  }
  const costUsd = requestCount * PRICE_PER_REQUEST;
  filtered._mapsUsage = {
    request_count: requestCount,
    cost_usd: costUsd,
    cost_jpy: Math.round(costUsd * 150),
  };
  return filtered;
}
