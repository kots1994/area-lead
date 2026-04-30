# AreaLead — エリア × 業種でアタックリスト自動生成

業種・エリア・キーワードを入力すると、Google Maps API で営業先リストを取得し、各社のWebサイトを軽量スクレイピングしてメールアドレス・問合せフォーム情報を補完するSaaSです。Colliers のテナント営業ワークフローを汎用化したもの。

## できること

1. **業種 × エリア検索** — 例: 「物流倉庫 千葉県印西市」「採用エージェント Shibuya」
2. **Google Places (New) API** で企業リスト取得（社名・住所・電話・サイト・★評価・座標）
3. **Webサイト軽量スクレイプ** で
   - メールアドレス（最大5件）
   - 問合せフォームURL
   - 問合せフォーム有無の判定
   - メタディスクリプション
4. **CSVダウンロード** （UTF-8 BOM 付き、Excel直接OK）

## ローカル起動

```bash
# 1. Google Maps API key (Places API New) を取得
# 2. .env に書く
cp .env.example .env
# GOOGLE_MAPS_API_KEY=xxxxxxxxxxxxx

# 3. 起動
npm install
npm start
# → http://localhost:3000
```

## API

### `POST /api/search`

```json
{
  "industry": "物流倉庫",
  "area": "千葉県印西市",
  "keywords": "3PL",
  "language": "ja",
  "region": "JP",
  "max": 20,
  "enrich": true
}
```

レスポンス:
```json
{
  "ok": true,
  "query": "物流倉庫 3PL 千葉県印西市",
  "count": 12,
  "rows": [{
    "name": "○○ロジスティクス",
    "address": "千葉県印西市...",
    "phone": "047...",
    "website": "https://...",
    "emails": "info@...;sales@...",
    "contact_url": "https://.../contact",
    "has_inquiry_form": true,
    "meta_description": "...",
    "rating": 4.2,
    "review_count": 18,
    "lat": 35.79,
    "lng": 140.16,
    "...": "..."
  }],
  "csv_base64": "..."
}
```

## ファイル構成

```
area-lead/
├── server/
│   ├── index.js         Express server
│   └── lib/
│       ├── places.js    Google Places API wrapper
│       ├── scraper.js   Website enrichment (cheerio)
│       └── csv.js       CSV exporter
├── public/
│   ├── index.html       Form + results UI
│   ├── style.css
│   └── app.js
├── landing/index.html   Landing page
├── store-assets/        Marketing visuals
├── .env.example
├── package.json
└── README.md
```

## 想定する利用シナリオ

- **インサイドセールス / SDR**: 担当エリアの新規開拓リストを毎週生成
- **不動産仲介**: 物件周辺のテナント候補をリストアップ
- **採用エージェント**: 業界 × エリアで求人企業候補を発掘
- **M&A仲介**: 業種 × 地域で買収候補をスクリーニング
- **広告代理店**: 業種別で広告主候補を生成

## 価格プラン（予定）

| プラン | 月額 | 月のリスト生成上限 |
|---|---|---|
| Free | ¥0 | 50行/月 |
| Starter | ¥2,980 | 1,000行/月 |
| Pro | ¥9,800 | 10,000行/月 |
| Enterprise | お問い合わせ | 無制限 + 専用API |

## ライセンス

MIT (TBD)

## 連絡先

makotoejima@gmail.com
