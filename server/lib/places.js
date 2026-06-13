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

async function textSearchOne({ query, languageCode, regionCode, apiKey, pageSize = 20, circle }) {
  const body = { textQuery: query, languageCode, pageSize };
  if (regionCode) body.regionCode = regionCode;
  if (circle) {
    body.locationRestriction = {
      circle: {
        center: { latitude: circle.lat, longitude: circle.lng },
        radius: circle.radiusMeters,
      },
    };
  }
  const resp = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Places API ${resp.status}: ${t.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.places || [];
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

export async function searchTargets({ queries, languageCode = "ja", regionCode = "JP", apiKey, companyKeywords, circle }) {
  const results = new Map();
  let requestCount = 0;
  let lastError = null;
  for (const q of queries) {
    try {
      const places = await textSearchOne({ query: q, languageCode, regionCode, apiKey, circle });
      requestCount++;
      for (const p of places) {
        if (!p.id) continue;
        if (!results.has(p.id)) results.set(p.id, p);
      }
    } catch (e) {
      lastError = e;
      console.warn(`[Places] query failed: "${q}" → ${e.message}`);
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
  const all = [...results.values()].map(normalizePlace);
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
