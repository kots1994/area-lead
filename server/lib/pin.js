// Google Maps のピン（共有URL / 座標文字列 / 短縮リンク）→ { lat, lng }
// 解析できなければ null。短縮リンク(maps.app.goo.gl 等)はリダイレクトを辿って解決する。

function mk(a, b) {
  const lat = Number(a), lng = Number(b);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  return null;
}

// 文字列(生座標 or URL or HTML本文)から lat/lng を抽出。精度の高い順に試す。
function parseLatLng(s) {
  if (!s) return null;
  const str = String(s).trim();

  // 1) 生の「緯度, 経度」
  const raw = str.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (raw) return mk(raw[1], raw[2]);

  // 2) /place/.../data=...!3d{lat}!4d{lng}（実際のピン位置で最も正確）
  let m = str.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return mk(m[1], m[2]);

  // 3) クエリ ?q= / query= / ll= / center= / destination=
  m = str.match(/[?&](?:q|query|ll|center|daddr|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return mk(m[1], m[2]);

  // 4) @{lat},{lng}（地図中心）
  m = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return mk(m[1], m[2]);

  return null;
}

export async function resolvePin(pin) {
  if (!pin) return null;
  const s = String(pin).trim();

  // まずそのまま解析（生座標・展開済みURL）
  const direct = parseLatLng(s);
  if (direct) return direct;

  // 短縮/共有リンクはリダイレクトを辿って展開してから再解析
  if (/^https?:\/\//i.test(s)) {
    try {
      const resp = await fetch(s, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
      const fromUrl = parseLatLng(resp.url || "");
      if (fromUrl) return fromUrl;
      const body = await resp.text();
      const fromBody = parseLatLng(body);
      if (fromBody) return fromBody;
    } catch {
      // ネットワーク失敗時は解決不可として扱う
    }
  }
  return null;
}
