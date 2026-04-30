// Google Places API (New) wrapper
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search

const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_NEARBY_SEARCH_URL = "https://places.googleapis.com/v1/places:searchNearby";

/**
 * Text search by query (e.g., "logistics warehouse near Inzai-shi")
 * @param {Object} opts
 * @param {string} opts.query — free-text query (industry + location combined)
 * @param {string} opts.languageCode — "ja" / "en"
 * @param {number} opts.maxResults — up to 20 per page (API limit)
 * @param {string} opts.regionCode — "JP" / "US" / "GB" etc.
 * @param {string} opts.apiKey
 */
export async function textSearch({ query, languageCode = "ja", maxResults = 20, regionCode, apiKey }) {
  const fieldMask = [
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
    "places.priceLevel",
    "places.location",
  ].join(",");

  const body = {
    textQuery: query,
    languageCode,
    pageSize: Math.min(maxResults, 20),
  };
  if (regionCode) body.regionCode = regionCode;

  const resp = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Places API error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.places || [];
}

/**
 * Normalize a Place result to flat row used by the rest of the pipeline.
 */
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
