// Google Distance Matrix API — filter rows by driving time from origin
// Pricing: $0.005 / element (origin × destination pair)

const MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
const BATCH_SIZE = 25; // API max destinations per request

export async function filterByDrivetime({ rows, origin, maxMinutes, apiKey }) {
  const originStr = `${origin.lat},${origin.lng}`;
  const out = [];
  let requestCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const destinations = batch
      .map((r) => (r.address ? encodeURIComponent(r.address) : `${r.lat},${r.lng}`))
      .join("|");

    try {
      const url = `${MATRIX_URL}?origins=${encodeURIComponent(originStr)}&destinations=${destinations}&mode=driving&language=ja&key=${apiKey}`;
      const resp = await fetch(url);
      requestCount++;
      if (!resp.ok) throw new Error(`DistanceMatrix ${resp.status}`);
      const data = await resp.json();
      // REQUEST_DENIED 等だと rows が空で、フィルタが効かないまま全件素通ししてしまう。
      // 設定漏れ（Distance Matrix API 未有効化）に気づけるよう明示的に投げる。
      if (data.status && data.status !== "OK") {
        const hint = data.status === "REQUEST_DENIED"
          ? "（Google Cloud で『Distance Matrix API』を有効化してください）"
          : "";
        throw new Error(`DistanceMatrix ${data.status}${data.error_message ? `: ${data.error_message}` : ""}${hint}`);
      }
      const elements = data.rows?.[0]?.elements || [];

      for (let j = 0; j < batch.length; j++) {
        const el = elements[j];
        const durationSec = el?.duration?.value;
        if (durationSec != null && durationSec <= maxMinutes * 60) {
          out.push({
            ...batch[j],
            drive_minutes: Math.round(durationSec / 60),
            drive_distance_km: el?.distance?.value != null
              ? Math.round(el.distance.value / 100) / 10
              : null,
          });
        }
      }
    } catch (e) {
      // 設定エラー（APIキー/未有効化）は全バッチで同じく失敗するので、握りつぶさず上位へ。
      if (/REQUEST_DENIED/.test(e.message)) throw e;
      console.warn(`[DistanceMatrix] batch ${i} failed: ${e.message}`);
      // 一時的エラーはフィルタせず素通し（リスト自体は返す）
      out.push(...batch);
    }
  }

  // Sort by drive_minutes (shortest first)
  out.sort((a, b) => (a.drive_minutes ?? 9999) - (b.drive_minutes ?? 9999));

  const costUsd = requestCount * BATCH_SIZE * 0.005;
  return { rows: out, requestCount, costUsd, costJpy: Math.round(costUsd * 150) };
}
