// Google Geocoding API — address → { lat, lng }
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocodeAddress({ address, apiKey }) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&language=ja&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Geocoding API ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    throw new Error(`ジオコード失敗: ${data.status} (${address})`);
  }
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}
