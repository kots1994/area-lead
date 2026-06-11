// Google Geocoding API — address → { lat, lng }
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export async function geocodeAddress({ address, apiKey }) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&language=ja&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Geocoding API ${resp.status}`);
  const data = await resp.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    // REQUEST_DENIED は大半が「Geocoding API 未有効化」or「キーのリファラー制限」。
    // 原因と対処をエラーに含めて、APIキー設定の取りこぼしに気づけるようにする。
    if (data.status === "REQUEST_DENIED") {
      const hint = data.error_message
        ? ` — ${data.error_message}`
        : " — Google Cloud で『Geocoding API』を有効化してください（キーにリファラー制限がある場合は解除/IP制限に変更）";
      throw new Error(`ジオコード失敗: REQUEST_DENIED (${address})${hint}`);
    }
    throw new Error(`ジオコード失敗: ${data.status} (${address})`);
  }
  const loc = data.results[0].geometry.location;
  return { lat: loc.lat, lng: loc.lng };
}
