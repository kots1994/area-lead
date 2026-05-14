# 📍 AreaLead — 倉庫テナント候補リスト自動生成

物件名・所在地・対象エリアを入力するだけで、Google Maps API と Claude API を使って近隣の物流関連企業を抽出 → AI で優先度判定 → サイトスクレイピングで連絡先補完 → CSV ダウンロードまで一気通貫で完結する Web アプリ。

**BYOK (Bring Your Own Key)**: あなたの Google Maps + Anthropic Claude API キーで動作。サーバー側で API 料金は発生しません。

## 使い方

1. **アカウント登録 / ログイン**（メールアドレス + パスワード）
2. **API キー設定**（右上⚙️）
   - Google Maps API Key（必須） → [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials) で発行・Places API (New) を有効化
   - Anthropic Claude API Key（任意・優先度判定用） → [Anthropic Console](https://console.anthropic.com/settings/keys) で発行
3. **物件情報を入力**:
   - 物件名（例: SOSiLA海老名）
   - 所在地・USP・対象エリア（カンマ区切り複数）
4. **「📡 リスト生成」** → 30秒〜1分で結果
5. **「📥 CSVダウンロード」** で Excel / Sheets に取り込み

## 機能

- **Google Places (New) で網羅検索**: 物流系8キーワード × 対象エリアの組合せ
- **社名フィルタ**: 「物流」「運輸」「ロジスティクス」等を含む企業のみ
- **Claude AI で優先度判定**: ★★★/★★☆/★☆☆ + 売上ランク + 物件フックに刺さる理由 + 推定担当部署
- **サイトスクレイピング**: メアド・問い合わせフォームURL・問合せフォーム有無を並列取得
- **CSV 出力**: UTF-8 BOM 付き、20+カラム

## API 料金の目安（あなたの請求）

1物件あたり約 **$1.50 ≒ ¥225**:
- Google Places (New): 8キーワード × 5エリア = 40クエリ × $0.035 = **$1.40**
- Anthropic Claude: 60社 → 3バッチ × $0.05 = **$0.16**
- スクレイピング: $0（サーバー処理）

新規 Google Maps Platform アカウントは初月 $200 クレジット付与あり（最初の数十物件は実質無料）。

## ローカル起動

```bash
git clone https://github.com/kots1994/area-lead.git
cd area-lead
npm install
npm start
# → http://localhost:3000/login.html
```

## Vercel デプロイ

```bash
npm i -g vercel
vercel
```

または GitHub repo を Vercel ダッシュボードから連携。環境変数は不要（BYOK）。

## ファイル構成

```
area-lead/
├── server/
│   ├── index.js         Express + auth + plan + APIエンドポイント
│   └── lib/
│       ├── auth.js      bcrypt + session
│       ├── plan.js      プラン状態 + 招待プログラム
│       ├── storage.js   file-based JSON storage
│       ├── places.js    Google Places API (BYOK)
│       ├── claude.js    Claude enrichment (BYOK)
│       ├── scraper.js   サイトスクレイピング
│       └── csv.js       CSV エクスポート
├── public/
│   ├── index.html       メイン画面
│   ├── login.html       ログイン / 新規登録
│   ├── plan.html        プラン管理
│   ├── app.js / login.js / plan.js / feedback.js
│   └── style.css
├── landing/             LP + privacy + tokushoho
├── package.json
└── vercel.json
```

## ライセンス

MIT

## 連絡先

makotoejima@gmail.com
