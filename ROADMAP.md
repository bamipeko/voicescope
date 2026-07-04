# VoiceScope Roadmap

Last updated: 2026-05-02

## Targets

VoiceScope ships in **three runtimes** sharing one `client/` codebase:

| Runtime | Target users | Status |
|---|---|---|
| **Electron desktop** (Windows/Mac) | パワーユーザー、自分用途、配信制作者 | ✅ Production (v0.17.1) |
| **Capacitor Android** | 友人配布、コミュニティメンバー、外出先利用 | 🔨 Phase 0 (scaffold complete) |
| **Browser / Docker** | NAS で動かす、複数デバイスで共有 | ✅ Production (legacy) |

## Plans (commercial)

| プラン | 月額 | API登録 | 認証 | 備考 |
|---|---|---|---|---|
| **完全ローカル** | ¥0 | 不要 | 不要 | Ollama / whisper.cpp、画像生成は非対応 |
| **自前APIキー** | ¥0 | ユーザー自身 | ユーザー自身 | gpt-image-2 使用には組織認証必須 |
| **おまかせ Trial** | ¥0 (14日) | 不要 | 運営側 | コードで有効化、全機能 |
| **おまかせ Pro** | ¥980 | 不要 | 運営側 | 標準モデル + 画像生成 |
| **おまかせ Heavy** | ¥2,480 | 不要 | 運営側 | 高性能モデル + 画像高品質 |

## Architecture

```
                    ┌──────────────────────────────────┐
                    │  client/  (React + Tailwind)      │ ← shared UI
                    │  shared lib: platform / storage / │
                    │  localEndpoint / api              │
                    └──┬───────────────┬──────────────┬─┘
                       │               │              │
            ┌──────────▼──┐   ┌────────▼──────┐   ┌──▼─────────┐
            │  electron/  │   │  mobile/      │   │  Docker    │
            │  Express +  │   │  Capacitor    │   │  Express + │
            │  sql.js     │   │  + SQLite     │   │  sql.js    │
            └──────┬──────┘   └────┬──────────┘   └──┬─────────┘
                   │               │                 │
                   └───────┬───────┴────────┬────────┘
                           │                │
              ┌────────────▼─────┐   ┌──────▼──────────┐
              │ Cloudflare Worker │   │ Direct provider│
              │ (managed mode)    │   │ APIs           │
              │ • OpenAI gpt-img-2│   │ (own-key mode) │
              │ • Anthropic       │   │                │
              │ • Gemini          │   │                │
              │ • Deepgram        │   │                │
              │ • Whisper         │   │                │
              │ • Grok            │   │                │
              └───────────────────┘   └────────────────┘

              ┌────────────────────┐
              │ Local LLM endpoint │ ← preserved on every platform
              │ • Ollama (PC/NAS)  │
              │ • whisper.cpp      │
              │ • Companion apps   │
              │   (Maid / Layla /  │
              │    MLC Chat /      │
              │    Termux+Ollama)  │
              └────────────────────┘
```

## Completed (this session, 2026-04-29 → 2026-05-02)

### v0.15.x → v0.17.1 — gpt-image-2 統合 + 致命バグ駆除
- gpt-image-2 を採用 (gpt-image-1 系は日本語不可)
- `executeReturningId` で sql.js の `last_insert_rowid()=0` バグ駆除 (5箇所修正)
- Service Worker キャッシュ固定化を解消 (バージョン化キャッシュ + network-first HTML)
- ファイル名衝突防止 (timestamp 追加)
- TDZ クラッシュ修正 (Dashboard.jsx の宣言順)
- 緊急リカバリ画面 (5秒ウォッチドッグ + SW全削除ボタン)
- 非同期画像生成 + ライトボックス + ダッシュボード 🎨 バッジ
- Low をデフォルト品質に
- update.cmd ワンショットビルド+インストール+起動

### Worker (cloudflare/) — 既存 + 拡張
- 既存: `/verify`, `/v1/chat/completions` (OpenAI/Grok), `/v1/messages` (Anthropic),
  `/v1/transcribe` (Deepgram), `/v1/audio/transcriptions` (Whisper)
- 追加: `/v1/images/generations`, `/v1/images/edits` (gpt-image-2)
- 追加: `/v1beta/models/:model/generateContent` (Gemini)
- model-guard 拡張 (image + Gemini モデル登録, free/trial/pro/heavy 階層)
- README + デプロイ手順

### Mobile (mobile/) — 新規 scaffold
- `package.json` (Capacitor 7 + 必要プラグイン)
- `capacitor.config.ts` (appId / webDir / Android 設定)
- `.gitignore`
- 包括的 README (cap init から APK 署名まで)

### 共通基盤 (client/src/lib/)
- `platform.js` — Electron / Capacitor / Browser ランタイム検出
- `storage.js` — KV ストレージ抽象化 (electron-store / Preferences / localStorage)
- `localEndpoint.js` — ローカルLLMエンドポイント設定 (Ollama / 各種コンパニオンアプリ)

## Next Up — Phase 1 (1〜2 週間)

### Worker
- [ ] **デプロイ**: `wrangler deploy` で本番反映
- [ ] **シークレット投入**: `wrangler secret put` で全 API キー登録
  - JWT_SECRET, OPENAI_API_KEY, DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GEMINI_API_KEY, GROK_API_KEY
- [ ] **コード seed**: `npm run seed` で初期コード投入
- [ ] **動作確認**: curl で /verify → JWT → /v1/chat/completions

### Mobile (Phase 0 → Phase 1)
- [ ] `npm install` → `npx cap init` → `npx cap add android`
- [ ] AndroidManifest.xml 編集 (録音/通知/ストレージ権限)
- [ ] 初回エミュレータ起動 — 既存 client/dist がそのまま動くか
- [ ] DB 移行: sql.js (browser) → `@capacitor-community/sqlite` (native)
  - server/db/database.js のロジックをクライアント側に移植
- [ ] Filesystem 抽象化: 録音ファイルの保存先を Capacitor Filesystem 経由に
- [ ] **Settings に「ローカル処理エンドポイント」UI 追加** (`localEndpoint.js` の API を呼ぶ画面)
- [ ] 録音ボタン動作確認 (MediaRecorder + Filesystem)

## Next Up — Phase 2 (2〜4 週間)

### Mobile 特化機能
- [ ] **Foreground Service** で背景録音継続
- [ ] 通知バー常駐 (録音中表示、ハイライトボタン)
- [ ] ギャラリー保存 (生成画像を Photos に出力)
- [ ] 共有シート (生成画像を Twitter / LINE / メールへ)
- [ ] Wi-Fi 限定アップロードオプション
- [ ] データ容量管理 UI (古い録音の自動削除設定)

### Worker 強化
- [ ] Gemini ストリーミング対応
- [ ] エラー時のフォールバック (1社ダウン時に別社へ)
- [ ] usage tracking (per-code 集計、月次レポート用)

## Next Up — Phase 3 (配布)

- [ ] Release keystore 生成
- [ ] 署名付き APK ビルド
- [ ] サイドロード配布 (友人向け、Google Drive 共有)
- [ ] (任意) Play Console 申請 ($25)

## Out of scope (今は触らない)

- iOS 対応 (Mac 必須、ユーザー判断で保留)
- ネイティブ Kotlin 化 (Capacitor で十分)
- LLM のオンデバイス埋め込み (アプリサイズ的に非現実、companion アプリ経由で代替)
- マルチユーザー / アカウント機能 (個人/友人配布想定で不要)
- ペイメント統合 (Phase 1 はトライアルコードで運用、Stripe は後)

## Decisions log

- **2026-04-30**: gpt-image-1 / 1.5 を完全削除、gpt-image-2 一本化 (日本語テキスト)
- **2026-04-30**: Low を画像生成のデフォルトに (実測十分、コスト 1/10)
- **2026-05-02**: Capacitor 採用決定 (vs React Native / PWA / Tauri Mobile)
- **2026-05-02**: monorepo 案採用 (vs 別リポジトリフォーク)
- **2026-05-02**: ローカル処理は **app に LLM 埋め込みせず**、HTTP エンドポイント方式で統一
  - 自宅 PC の Ollama / NAS の Ollama / Termux + Ollama / コンパニオン Android アプリ
- **2026-05-02**: Worker と Mobile の同時並行開発、両方を Phase 1 で動作確認
