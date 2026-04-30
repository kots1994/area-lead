# AreaLead — Marketing & GTM Plan

Last updated: 2026-05-01

## Positioning

> **AreaLead: Type "industry × area" → get a sales list with emails. Built for inside sales, real estate, and recruiting.**

## Differentiation

| Tool | Positioning | Price | AreaLead vs. |
|---|---|---|---|
| **Apollo.io** | Massive global SaaS DB | $59-99/seat | Apollo lacks small-area Japanese SMBs; AreaLead Maps-native catches local |
| **Sales Marker (JP)** | Intent-based DB | ¥400K/mo+ | Enterprise-only; AreaLead is SMB price point |
| **Wiza** | LinkedIn scraper | $83+/mo | Wiza needs LinkedIn URL; AreaLead works from "industry + area" |
| **PhantomBuster** | LinkedIn/Maps scrapers DIY | $69+/mo | DIY assembly; AreaLead is one-click product |
| **Google Maps + manual scrape** | DIY | Time | The status quo for indie sales pros |

**Wedge**: Japanese local SMB market, ¥2,980/mo entry point, "サクッと営業フォーム" との連携で list-to-send までのループが完結する。

## Target ICPs

### Primary
- **不動産仲介** (28万人, 国交省 2024) — Colliers Shun の現場発インサイト。物件周辺リスト需要は確実
- **インサイドセールス / SDR** (3-5万人) — 担当エリアの新規リスト毎週生成
- **採用エージェント** (4-5万人) — 業界×エリアで企業発掘
- **広告代理店** (yama / keigo の既存事業の補完)

### Secondary
- M&A仲介、士業、補助金コンサル、フランチャイズ本部、保険ブローカー

## Pricing strategy

| Plan | Price | Quota | Target |
|---|---|---|---|
| Free | ¥0 | 50 rows/month | Trial / very small users |
| Starter | ¥2,980/mo | 1,000 rows/mo | Independent reps, freelancers |
| Pro | ¥9,800/mo | 10,000 rows/mo | Active SDRs, small teams |
| Enterprise | Custom | Unlimited | Brokerages, agencies |

**Why ¥2,980 entry**: In Japan SMB SaaS sweet spot. Below ¥3,000 individual professionals can buy without procurement. Above Free quota's 50 rows = 1 week of trial usage, forces upgrade.

## Launch channels (first 30 days)

### Day 0-7: Soft launch
- Deploy MVP to Vercel/Cloudflare Pages
- Buy `arealead.app` or `arealead.io` domain
- Notion-published Privacy Policy
- Twitter/X account, LinkedIn page

### Day 7-14: Validate with N=10
- **Shun** (Colliers): Customer Zero — 物件周辺リスト生成で実利用テスト
- 不動産仲介3名 (Shun経由)
- 採用エージェント2名 (LinkedIn DM)
- M&A仲介2名
- フリーランス営業2名
- 広告代理店yama: 既存リードリスト補完用途で

価格仮説検証: ¥2,980 / ¥9,800 を「払えるか」アンケート。3/10 が「Pro 払う」なら GO。

### Day 14-21: Public launch
- **Twitter / LinkedIn**: 営業職フォロワー向けデモ動画 (60秒)
  - 「物流倉庫 千葉県印西市」と入れる → 12社のリストが30秒で出る → CSV
- **Indie Hackers JP**: Build journey post
- **note**: 「サクッと営業フォーム + AreaLead」の使い回しTips
- **不動産系メディア**: HOME'S Press / 楽待 / 健美家への寄稿
- 営業系YouTuber/ポッドキャスターにDM (10名)

### Day 21-30: SEO + 広告
- SEO target keywords:
  - "営業リスト 自動生成" (1.2K/月)
  - "Google Maps 営業リスト" (800/月)
  - "業種別 企業リスト" (500/月)
  - "アタックリスト 作成" (1.6K/月)
- Google Ads ¥30,000 で上記キーワードに小規模テスト
- Twitter Ads (営業職向けセグメント) ¥30,000

## KPIs (Day 90)

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Total signups | >300 | 100-300 | <100 |
| Free → Paid CVR | >5% | 2-5% | <2% |
| MRR | >¥50K | ¥10-50K | <¥10K |
| Avg lists/Pro user/mo | >40 | 10-40 | <10 |

## Cross-product synergy

**サクッと営業フォーム** + **AreaLead** = end-to-end loop:
1. AreaLead でリスト生成 (CSV)
2. 各行の "問合せフォームあり" マークをフィルタ
3. CSVから1社ずつブラウザで開く (将来は一括オープン機能)
4. サクッと営業フォーム で自動入力 → 送信

LP/メール/Twitter で常に「セットで使うと爆速」と訴求。Bundle 価格 (¥980 + ¥2,980 → ¥3,500) で誘導。

## Roadmap

### v0.2 (Month 2)
- ユーザー認証 (Magic Link) + 課金 (Stripe)
- リスト履歴・再エクスポート
- 1検索内で複数キーワード自動展開 (industry × keywords cross-product)

### v0.3 (Month 3)
- Google Sheets / Slack連携
- 「サクッと営業フォーム」拡張機能との API連携 (CSV取り込み + 一括フォーム送信)
- スクレイピング深化: SNSアカウント、従業員数推定、最終更新日

### v0.5 (Month 6)
- LLM 補強: 「この会社の事業内容を1行で」「営業メールの件名候補を3つ」
- CRM 直接連携 (HubSpot, Salesforce, Pipedrive)
- 多言語: US/UK/CA/AU 完全対応

## Sources

- [Sales Marker pricing](https://sales-marker.jp/plan)
- [Apollo Pricing](https://www.apollo.io/pricing)
- [Wiza Pricing](https://wiza.co/pricing)
- 国交省 不動産業統計 (2024)
- 日本人材紹介事業協会 (2024)
