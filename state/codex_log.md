# Codex 引継ぎログ - VoiceScope

> このファイルは Codex が文脈ゼロから読んで作業を再開できることを目的とした
> ハンドオフドキュメント。過去の議論詳細は `state/claude_log.md` 参照。
>
> 最終更新: 2026-05-06 (Codex 引き継ぎ開始)
> プロジェクト現バージョン: **v0.18.0**

---

## 0. 2026-05-06 Codex 引き継ぎ開始メモ

- `state/claude_log.md` と `state/codex_log.md` を確認済み。
- 直近の大きな流れは **gpt-image-2 統合 → Worker + Mobile 並行スキャフォールド**。
- Git には大量の未コミット変更あり。実装本体を触る前に、差分を論理単位で確認してから進める。
- 次の有力着手点は Worker 本番デプロイ準備、Mobile Capacitor 初期化、Android 権限追加、Settings のローカル処理エンドポイント UI。
- `Z:\` は Codex sandbox で直接 workdir にできない場合があるため、ローカル workdir から `Z:\projects\voicescape` を絶対パス指定する。

## 0.1 2026-05-12 Codex 修正メモ: 要約モデルと要約UX

- 公式情報を確認し、要約/質問/整形用のLLM候補を現行モデルへ更新。
  - OpenAI: `gpt-5.4-*` と `gpt-5.5`
  - Gemini: `gemini-2.5-flash-lite`, `gemini-3-flash-preview`, `gemini-3-pro-preview`
  - Claude: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`
  - Grok: `grok-4.3`, `grok-4.20-*`
- `grok-4-1-fast-*` は xAI 公式で 2026-05-15 退役予定のため候補から除外。
- テンプレート編集の「優先LLM」を廃止し、「優先モデル」だけを保存する形へ変更。サーバ側でモデルIDから provider を推定する。
- 設定画面に `auto_summarize_uploads` を追加。アップロード時の自動要約ON/OFFを保存し、アップロードダイアログとサーバ既定値に反映。
- `summaries.custom_prompt` を追加。カスタムプロンプトで要約した場合、録音詳細の要約欄から使用プロンプトを後から表示できる。
- 既存DB向けに retired model id の設定/テンプレート移行処理を追加。
- 検証:
  - `npm.cmd run build --prefix Z:\projects\voicescape` 成功
  - `node --check` 成功: `server/services/summary/index.js`, `server/routes/recordings.js`, `server/db/database.js`, `server/services/pipeline.js`
  - `npx.cmd tsc --noEmit` 成功: `worker`

## 1. プロジェクト目的

**VoiceScope** = 音声録音 + 文字起こし + AI要約 + インフォグラフィック画像生成 を
ローカルファースト + マルチプラットフォームで提供するアプリ群。

- 主用途: 配信・会議・ノート録音 → 自動文字起こし → 要約・推敲 → SNS用ビジュアル生成
- 配布想定: 自分用 + 友人 + コミュニティメンバー（非エンジニア層）
- 商用化: トライアルコード方式 + サブスクリプション（Pro ¥980 / Heavy ¥2,480）
- **重要原則**: 完全ローカル処理の選択肢を絶対に消さない（Ollama/whisper.cpp 連携必須）

---

## 2. アーキテクチャ / 主要モジュール

### モノレポ構造（3 ターゲット同居）

| ディレクトリ | 役割 | ステータス |
|---|---|---|
| `client/` | React + Vite + Tailwind v4 + Zustand のUI層（全ターゲット共有） | Production |
| `server/` | Express + sql.js (WASM SQLite) バックエンド | Production |
| `electron/` | Electron シェル（main.cjs + preload + tray + server起動） | Production v0.18.0 |
| `mobile/` | Capacitor 7 Android アプリ（client/ をラップ） | **Phase 0 scaffold（cap init 待ち）** |
| `worker/` | Cloudflare Worker（Hono + TS、APIプロキシ + JWT認証） | コード完成、デプロイ待ち |
| `data/` | SQLite DB + 音声ファイル（Docker版のボリュームマウント先） | - |
| `state/` | claude_*.md / codex_*.md（Discord ブリッジ用） | - |
| `scripts/` | build-mac.sh / build-win-portable.ps1 / etc. | - |

### server/ サブモジュール

| ファイル | 役割 |
|---|---|
| `index.js` | Express ルーター登録、CSP/Helmet、認証ミドルウェア（メディアストリームは query-token 許可） |
| `db/database.js` | sql.js 初期化、`execute` / `executeReturningId` / `queryOne` / `queryAll` |
| `db/schema.sql` | 全テーブル定義（recordings / transcriptions / summaries / infographics / tags / etc.） |
| `routes/recordings.js` | 録音 CRUD、文字起こし、要約、Ask、ファイル配信 |
| `routes/infographic.js` | インフォグラフィック生成、プリセット、画像配信、reveal |
| `routes/cross-ask.js` | 複数録音横断質問（Phase 2 機能） |
| `routes/folders.js` `tags.js` `templates.js` `settings.js` | 各種CRUD |
| `services/transcription/` | Deepgram / Whisper / Grok-STT / whisper.cpp / faster-whisper |
| `services/summary/` | OpenAI / Claude / Gemini / Grok / Ollama / Custom |
| `services/infographic/` | structurer.js (LLM→JSON) + generator.js (gpt-image-2) + styles.js |
| `services/managed.js` | Worker 経由判定（tier × APIキー有無 → managed/ownkey 切替） |
| `services/processing-mode.js` | offline / ownkey / managed の状態管理 |
| `services/refine.js` `tagging.js` `pipeline.js` | 自動推敲・タグ付け・パイプライン |
| `middleware/tier.js` | サブスクリプション tier の検証 |

### client/src/ サブモジュール

| ファイル | 役割 |
|---|---|
| `lib/api.js` | サーバ API クライアント（fetch ラッパ + token 付与） |
| `lib/platform.js` | **新規** Electron/Capacitor/Browser 検出 + capability flags |
| `lib/storage.js` | **新規** electron-store / Capacitor Preferences / localStorage 抽象化 |
| `lib/localEndpoint.js` | **新規** ローカル LLM エンドポイント設定 + 5 プリセット |
| `lib/models.js` | Tier × Provider × Model のマッピング |
| `stores/appStore.js` | Zustand: toasts / tier / pendingInfographics / etc. |
| `pages/Dashboard.jsx` | 録音一覧、フィルタ、🎨 N バッジ、生成中インジケーター |
| `pages/RecordingDetail.jsx` | 詳細：文字起こし/要約/画像/タグ/AI質問タブ、ライトボックス |
| `pages/Settings.jsx` | API キー、プラン、エクスポートパス等 |
| `pages/CrossAsk.jsx` | 横断質問 |
| `pages/Templates.jsx` | 要約テンプレート編集 |
| `pages/Archive.jsx` `Trash.jsx` | アーカイブ・ゴミ箱 |
| `components/InfographicModal.jsx` | 構造化→生成 2段階フロー、組織認証案内 |
| `components/ImageLightbox.jsx` | **新規** 画像クリック拡大表示（Esc 対応） |
| `components/SetupWizard.jsx` | 初回 API キー入力 |
| `components/Layout.jsx` | サイドバー、ナビ、トースト表示 |

### worker/src/

| ファイル | 役割 |
|---|---|
| `index.ts` | Hono ルーター、全エンドポイント登録 |
| `auth.ts` | JWT 発行・検証（Web Crypto API 使用、HS256） |
| `routes/verify.ts` | コード検証 → JWT 発行 |
| `routes/openai.ts` | `/v1/chat/completions` (OpenAI/Grok) |
| `routes/anthropic.ts` | `/v1/messages` (Claude) |
| `routes/transcribe.ts` | `/v1/transcribe` (Deepgram raw audio) |
| `routes/images.ts` | **新規** `/v1/images/generations` + `/v1/images/edits` (gpt-image-2) |
| `routes/gemini.ts` | **新規** `/v1beta/models/:model:generateContent` |
| `middleware/model-guard.ts` | tier × model 許可リスト |
| `middleware/rate-limit.ts` | per-code + per-device レート制限（KV ベース） |

### electron/

| ファイル | 役割 |
|---|---|
| `main.cjs` | エントリ、ウィンドウ管理、IPC ハンドラ |
| `server-manager.cjs` | Express サーバを子プロセスで起動 + ログをファイル永続化 |
| `store-manager.cjs` | electron-store ラッパ（API キー、設定） |
| `preload.cjs` | window.electronAPI を context isolation 経由で公開 |
| `tray-manager.cjs` | システムトレイ（録音中インジケータ等） |
| `process-monitor.cjs` | ポート競合チェック、orphan プロセス kill |
| `update-checker.cjs` | 自動アップデート（GitHub Releases ベース） |
| `discord-rpc.cjs` | Discord Rich Presence |

---

## 3. 現在の状態

### 稼働中の機能
- 録音 → 文字起こし（Deepgram メイン） → 要約（任意LLM） → 推敲 → タグ自動付与
- インフォグラフィック生成（gpt-image-2、日本語テキスト描画対応）
- 録音管理（Dashboard / Archive / Trash の3層、ソフト削除）
- フォルダ管理（ドラッグ&ドロップ）
- AI質問（録音単体 / 横断）
- テンプレート CRUD
- エクスプローラ起動（Win/Mac/Linux）
- 自動エクスポート（音声 + インフォグラフィック画像）
- Discord ブリッジ統合

### opt-in 機能
- whisper.cpp / faster-whisper のローカル文字起こし
- Ollama 経由のローカル要約
- アーカイブ自動削除（保持期間設定）

### 直近のトレンド（v0.15 → v0.18）
- `gpt-image-1` 系 → `gpt-image-2` 全面切替（日本語対応）
- sql.js の `last_insert_rowid()=0` バグ駆除（5箇所）
- Service Worker キャッシュ固定化解消（バージョン化）
- 非同期画像生成 + ライトボックス + ダッシュボード🎨バッジ
- Cloudflare Worker 拡張（image + Gemini プロキシ）
- Mobile (Capacitor) 用 monorepo 構造を新設

---

## 4. デプロイ / インフラ

### Electron 配布
- ビルド: `update.cmd`（NAS同期 → 依存インストール → Vite build → electron-builder → 自動上書きインストール → 起動）
- 出力: `C:\projects\voicescape-build\dist-electron\VoiceScope Setup <ver>.exe`
- インストール先: `%LOCALAPPDATA%\Programs\VoiceScope\` (per-user)
- データ: `%APPDATA%\VoiceScope\` (DB、音声、画像、ログ、Cache)

### サーバ常駐モード
- `npm start`（PM2 等で運用想定、v0.x ではまだ未デプロイ）
- ポート: 5100

### Docker（自前ホスト用、レガシー）
- `docker-compose.yml` あり（DEEPGRAM_API_KEY 等を環境変数で注入）

### Cloudflare Worker（2026-07-03 デプロイ済み）
- アカウント: tka8963@gmail.com のCloudflareアカウント（旧記載の「tka1478」は誤りだった）
- Worker 名: `voicescope` / workers.dev サブドメイン: `voicescope`（2026-07-03登録）
- **本番 URL: `https://voicescope.voicescope.workers.dev`**
- KV namespace: `CODES` (id: `5254f3b791f64a91840d254d3f7b059a`。旧IDの889b...は実在しなかったため作り直し)
- ワンショット再デプロイ: `worker\deploy.ps1`（ログイン→シークレット→seed→deploy→スモーク）
- デプロイコマンド: `cd worker && npm install && npm run deploy`
- シークレット: `JWT_SECRET` / `OPENAI_API_KEY` / `DEEPGRAM_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GEMINI_API_KEY` / `GROK_API_KEY`
- 投入: `wrangler secret put <KEY>` 各回

### Mobile 配布（未着手）
- Phase 0 完了、`npx cap add android` 以降がユーザー側作業
- 想定: Android Studio + Sumika 用に既にインストール済の SDK / JDK / AVD を共有
- パッケージ名: `com.bamipeko.voicescape`
- 配布: 当面サイドロード（友人向け）、Play Store は後

### NAS（DXP2800、IP 192.168.0.92）
- VoiceScope は NAS 側にホストしていない（個人 Win/Mac 配布のみ）
- 将来的に NAS Ollama 経由のローカル LLM パスは想定済み

---

## 5. API エンドポイント / DB スキーマ要点

### 主要 DB テーブル
- `recordings` (id TEXT, file_path, status, importance, archived_at, trashed_at, refine_warning, ...)
- `transcriptions` (id, recording_id, segments_json, refined_segments_json, ...)
- `summaries` (id, recording_id, template_id, llm_provider, llm_model, content)
- `infographics` (id, recording_id, structure_json, style, custom_prompt, aspect_ratio, quality, model, image_paths_json, cost_usd)
- `infographic_presets` (id, name, reference_image_paths_json, default_style, ...)
- `templates` (id, name, system_prompt, output_format, is_default, preferred_llm_provider, preferred_llm_model)
- `tags` + `recording_tags` (タグマスター + 中間テーブル)
- `folders` + `recording_folders`
- `settings` (key, value JSON 形式)
- `chat_messages` / `cross_chat_messages` (AI質問履歴)

### サーバ API
- `/api/recordings` GET (state filter / search / tag / folder / importance, infographic_count 含む)
- `/api/recordings/:id` GET / PATCH / DELETE
- `/api/recordings/:id/transcribe` POST
- `/api/recordings/:id/summarize` POST
- `/api/recordings/:id/refine` POST
- `/api/recordings/:id/ask` POST
- `/api/infographic/recordings/:id/structure` POST
- `/api/infographic/recordings/:id/generate` POST (multipart)
- `/api/infographic/recordings/:id/list` GET
- `/api/infographic/recordings/:id/rescue` POST（DB↔ディスク照合）
- `/api/infographic/:id/image/:n` GET (メディア配信、token query 対応)
- `/api/infographic/styles` GET（スタイル + structurer 情報 + image_model）
- `/api/cross-ask` POST + GET履歴
- `/api/settings/*` `/api/templates/*` `/api/folders/*` `/api/tags/*`

### Worker API
- `GET /health` 認証不要
- `POST /verify` body: { code, deviceHash } → { token, tier, expiry, ... }
- `POST /v1/chat/completions` Bearer JWT (OpenAI/Grok)
- `POST /v1/messages` Bearer JWT or x-api-key (Anthropic)
- `POST /v1/transcribe` Bearer JWT (Deepgram raw audio)
- `POST /v1/audio/transcriptions` Bearer JWT (OpenAI Whisper multipart)
- `POST /v1/images/generations` Bearer JWT (gpt-image-2 JSON)
- `POST /v1/images/edits` Bearer JWT (gpt-image-2 multipart)
- `POST /v1beta/models/:model:generateContent` Bearer JWT (Gemini)

---

## 6. 重要な過去の決定（地雷マップ）

### 🔴 sql.js の `db.export()` は接続をリセットする
- `runAndSave()` の `save()` 内で `db.export()` が呼ばれ、内部的に DB 接続が close→open される
- 結果、`last_insert_rowid()` が **0 にリセット**
- 修正: `executeReturningId(sql, params)` を `db.run` 直後・`save()` 前に rowid 取得するヘルパとして導入
- **新規 INSERT で id が必要なケースは絶対に `executeReturningId` を使うこと**
- 旧 `lastInsertRowId()` は残してあるが INSERT 直後に呼ぶと壊れる

### 🔴 Service Worker キャッシュ
- `client/public/sw.js` の `CACHE_NAME` は **リリースごとに更新必須**（バージョン文字列含めること）
- 固定キャッシュ名にすると新版 HTML が永遠に出ない
- HTML/Navigation は network-first（更新を即反映）、ハッシュ付き静的アセットは cache-first
- ユーザー救済用に `index.html` に 5秒ウォッチドッグ + 緊急リカバリ画面を実装済

### 🔴 ファイル名衝突防止
- インフォグラフィックのファイル名は `rec_<recId>_ig_<rowId>_<ts>_<n>.png`
- DB リセット時の rowid 重複対策に **ミリ秒タイムスタンプ必須**
- 書き込み前に `existsSync` ガードあり

### 🔴 gpt-image-2 は組織認証必須
- OpenAI Verified Organization のみアクセス可
- 個人ユーザーが直接使うには ID 認証 + 顔認証 + 15分待ち
- 運営側で認証済みのキーを Worker 経由で配ることで、エンドユーザーは認証不要にできる
- これが「おまかせプラン」の戦略的差別化点

### 🟡 gpt-image-1 / 1.5 は使わない
- 日本語テキスト描画が破綻するため
- model-guard でも **gpt-image-2 のみ許可**
- 復活させてはいけない

### 🟡 Default 品質は `low`
- 実測で日本語テキスト品質十分
- `auto` はコスト読めず（最大35倍ブレ）
- 既存設定の互換性維持のため `auto` も選択肢に残してある

### 🟡 React Hooks 宣言順
- 過去 `pendingInfographics` の宣言を useEffect の後に置いて TDZ クラッシュ
- すべての useState/useRef/useCallback は使用箇所より前に置くこと
- ESLint の `react-hooks/exhaustive-deps` は強化候補

### 🟡 Electron + sql.js のローダー
- `db/database.js` で WASM のパス解決に複数のフォールバック（asar.unpacked 対応）
- 環境変数 `VOICESCOPE_SQLJS_WASM` で上書き可能（Bun 単一バイナリ用）
- `electron-builder` の asarUnpack に sql.js wasm が含まれていること必須

### 🟡 認証ミドルウェアのメディアストリーム
- 画像配信エンドポイント（`/recordings/:id/audio`、`/infographic/:id/image/:n`）は
  カスタムヘッダ送れない `<img src>` / `<audio src>` で叩かれる
- そのため **query-param `?token=xxx`** でも認証可能にしてある
- 新メディアエンドポイント追加時はこのパスパターンに加える

---

## 7. ユーザーの好み / 哲学

### Bami（プロジェクトオーナー、非エンジニア寄り）の方針
- **「調べさせない」原則**: ユーザーが詰まる前に手段を提示する
- **加工・整形が苦手**: ボタン1個で済むものを複数手順にしない
- **シンプル指向**: 過剰実装を嫌う、最小限から始める
- **コミュニティ運営本業**: 機能より「友人に渡せる安心感」優先
- **ローカル処理を捨てない**: クラウド一辺倒の設計は受け入れない
- **戦略的にユーザー体験を分岐**: 「面倒なAPI登録 → おまかせプランへの導線」のような設計

### コーディング規約
- コード・コメント英語、UI 日本語
- 結論ファースト、推測と確定を分ける
- API キーは `.env` か electron-store、絶対ハードコードしない
- 1機能1コミット、ミックスしない
- バージョンバンプ時は SW の `CACHE_NAME` も同時更新（必須）

### コミュニケーション
- 中立フラットに評価（提案を盲信しない、明確な反対意見も歓迎）
- 段階的に深掘り、即決しない判断は明示

---

## 8. 既知の落とし穴

| 症状 | 原因 | 対処 |
|---|---|---|
| インフォグラフィック生成後 0枚表示 | `last_insert_rowid()=0` バグ | v0.16.6 で修正、`executeReturningId` 使用 |
| 起動後 灰色画面 | Dashboard.jsx の TDZ または SW キャッシュ | v0.17.1 で修正、`index.html` の緊急リカバリパネル参照 |
| 再ビルドしても古いUI | SW `CACHE_NAME` 未更新 | バージョン上げる時は必ず sw.js も更新 |
| インフォグラフィック画像消失 | 旧ファイル名 `rec_<recId>_ig_<rowId>_<n>.png` の rowid 衝突 | タイムスタンプ追加で解決済 |
| 「OpenAI APIキーが無効」誤誘導 | gpt-image-2 の組織認証が原因 | エラー文を本文化済（403 → 認証案内） |
| Whisper.cpp 文字起こし silent fail | webm 形式 / モデル未DL / 汎用エラー | ffmpeg 自動変換 + resolveModel + API レスポンスに本物のエラー |
| 録音ボタン連打で並列ジョブ | 押下中の状態管理欠如 | 409 サーバガード + ボタン disable |
| `wrangler secret put` で 401 | wrangler login 切れ | `wrangler login` 再実行 |
| Capacitor Vite dev で `ERR_CLEARTEXT_NOT_PERMITTED` | HTTP cleartext 拒否 | capacitor.config の `cleartext: true` + AndroidManifest |
| Android Gradle Sync 失敗 | JDK バージョン不一致 | `JAVA_HOME` を Android Studio 同梱 JDK 17 へ |
| Z: ドライブで sandbox 失敗 | Codex desktop 制約 | 絶対パス `Z:\...` で実行 or 権限付き再試行 |

---

## 9. 直近変更したファイル / git log 抜粋

### git log (直近20件)
```
5790dba diag: add v0.15.4 marker, refresh button, and console diagnostics for infographics
d1fd34a fix: infographic Generate button no longer requires pre-structuring
4617f24 feat: infographic export folder + diagnostic for empty-paths bug
56e66e4 fix: infographic UX feedback — auto-structure, dedicated tab, image visibility
8e2c4c6 feat: infographic generation MVP — gpt-image-1 visualizer for summaries
e20fc66 fix: re-transcribe UX — two-step (select then execute) + double-click guard
a21b987 fix: whisper.cpp transcription robustness + Grok JA prompt + better errors
b36b422 docs: rewrite RELEASE.md to lead with Windows git workflow
8ebd854 feat: distribution pipeline — Mac DMG, Windows single-EXE, GitHub Actions, docs
7d07509 feat: client UI — Archive/Trash, CrossAsk, settings polish, refine prefs
afb0c59 feat: server foundations — standalone mode, tiers, managed worker, parallel pipeline
（以下省略）
```

### 未コミットの変更（v0.18.0、要 commit）
- 新規: `mobile/`（Capacitor scaffold）
- 新規: `worker/src/routes/{images.ts,gemini.ts}`、`worker/README.md`
- 新規: `client/src/lib/{platform.js,storage.js,localEndpoint.js}`
- 新規: `client/src/components/ImageLightbox.jsx`
- 新規: `ROADMAP.md`、`AGENTS.md`
- 変更: `worker/{wrangler.toml,src/index.ts,src/middleware/model-guard.ts}`
- 変更: `server/services/managed.js`（URL 更新）
- 変更: `server/db/database.js`（`executeReturningId`）
- 変更: `server/routes/{recordings.js,tags.js,templates.js,infographic.js}`、`server/services/{infographic/generator.js,pipeline.js}`（`executeReturningId` 移行）
- 変更: `client/src/{components/InfographicModal.jsx,pages/Dashboard.jsx,pages/RecordingDetail.jsx,stores/appStore.js,lib/api.js,public/sw.js,index.html}`
- 変更: `electron/server-manager.cjs`（ログファイル永続化）
- 変更: `package.json`（v0.17.1 → v0.18.0）、`build-exe.cmd`、`CLAUDE.md`

---

## 10. よく使うコマンド / 確認手順

### 開発
```powershell
# Electron 開発（HMR）
npm run electron:dev

# 本番ビルド + 起動
npm run electron:start

# 配布インストーラ作成 + 自動上書きインストール + 起動
update.cmd

# Docker 用
npm run dev    # サーバ + クライアント
npm run build  # client/dist 生成
npm start      # 本番サーバ
```

### Worker
```powershell
cd Z:\projects\voicescape\worker
npm install
wrangler secret put <KEY>     # 各シークレット
npm run seed                   # KV にコード投入
npm run deploy                 # 本番デプロイ
npm run dev                    # ローカル localhost:8787
```

### Mobile
```powershell
cd Z:\projects\voicescape\mobile
npm install
cd ..\client && npm run build
cd ..\mobile
npx cap add android            # 初回のみ
npx cap sync android
npx cap open android           # Android Studio 起動
```

### 動作確認
```powershell
# Worker ヘルス
curl https://voicescope.voicescope.workers.dev/health

# Worker /verify
curl -X POST https://voicescope.voicescope.workers.dev/verify `
  -H "Content-Type: application/json" `
  -d '{\"code\":\"VSTEST2026\",\"deviceHash\":\"abcdef0123456789\"}'

# Electron サーバログ
type %APPDATA%\VoiceScope\logs\server-2026-05-02.log
```

---

## 11. 未解決の問題 / TODO

### 即時（Phase 1、1〜2週間）
1. Worker 本番デプロイ（`wrangler deploy`） + シークレット投入 + コード seed
2. Mobile `npx cap init` + `npx cap add android` + 初回エミュレータ起動
3. AndroidManifest.xml に録音/通知/ストレージ権限追加（README 参照）
4. **DB 移行**: server/db/database.js のロジックを mobile 側で `@capacitor-community/sqlite` 経由に置換
5. **Filesystem 抽象化**: 録音ファイルを Capacitor Filesystem 経由に
6. **Settings 画面に「ローカル処理エンドポイント」UI 追加** (`localEndpoint.js` API を呼ぶ)

### 中期（Phase 2、2〜4週間）
- Foreground Service で背景録音継続（Android 14+ 必須）
- 通知バー常駐（録音中インジケータ + ハイライトボタン）
- ギャラリー保存（生成画像 → Photos）
- Capacitor Share シート統合
- Wi-Fi 限定アップロードオプション
- データ容量管理 UI（古い録音の自動削除）
- Worker: Gemini ストリーミング対応
- Worker: usage tracking（per-code 集計、月次レポート用）

### 長期（Phase 3、配布）
- Release keystore 生成 + 署名 APK
- 友人向けサイドロード配布（Google Drive 共有）
- (任意) Play Console 申請 ($25)

### 出力品質改善（任意、低優先）
- バンドルサイズ警告: client bundle 607KB → code-splitting 検討
- ESLint `react-hooks/exhaustive-deps` 強化（TDZ 再発防止）
- e2e テスト（Playwright）導入
- STATUS.md の自動更新スクリプト

---

## 12. 次に頼みたいこと（候補）

ユーザー（Bami）から次に依頼される可能性が高い順:

1. **Worker デプロイ実演**: `wrangler deploy` のデモ + 動作確認手順を一緒に走る
2. **Mobile cap init から最初のエミュレータ起動まで**: ユーザーが自力で進めるのは初手だけハードル高いので伴走必須
3. **DB / Storage / Filesystem の Capacitor 移植**: 設計が複数案あるので議論しながら
4. **Settings に「ローカル処理エンドポイント」UI 追加**: `localEndpoint.js` 既存 API を呼ぶフォーム
5. **Foreground Service 実装**: Android 14+ で必須、Capacitor プラグイン or ネイティブ
6. **おまかせモードの Electron 動作確認**: Worker デプロイ後、Trial コード入力 → 画像生成
7. **STATUS.md の自動更新**: セッション終了時に自動 commit するフック
8. **commit + push**: 現在大量の未コミット変更あり、論理単位で分けて commit したい

---

## 13. 機密扱い / Codex に渡さないもの

- `.env` の中身（API キー全種）
- `wrangler secret` で投入した値
- ユーザーの本名 / 個人情報 / 住所
- 録音された音声・文字起こしデータの実物
- Discord のサーバ ID / チャネル ID（必要なら別途共有）
- Cloudflare の account_id（公開しないがコードに置く必要なら別レポジ）
- 生成画像の本体（テスト用以外）

このログにはこれらの値は **一切含めていない**。

---

## 14. 過去の議論詳細 → claude_log.md 参照

`state/claude_log.md` に以下が時系列で記録されている:

- 2026-04-29〜30: gpt-image-2 統合 + 致命バグ駆除（v0.15.4 → v0.17.1）
- 2026-05-02: Worker + Mobile 並行スキャフォールド完了（v0.18.0）

特に重要な議論ポイント（claude_log で詳細あり）:
- gpt-image-1 から gpt-image-2 への切替経緯（日本語問題）
- sql.js `last_insert_rowid()=0` バグの原因究明プロセス
- アーキテクチャ判断（fal.ai / Cloudflare Worker / 現状の3案比較 → Worker 採用）
- ローカル処理保持戦略（5プリセット策定）
- プラン構成（完全ローカル / 自前APIキー / Trial / Pro / Heavy）

---

## 15. AGENTS.md / 返信運用ルール

### Discord ブリッジ運用
- Bot は本文だけ送る（プロンプト追加なし）
- 引継ぎ時は `state/codex_reply.md` (Codex) と `state/claude_reply.md` (Claude) を区別
- `*_reply.md` は **冒頭に最新ユーザー投稿を引用必須**
- 長文ユーザー投稿は要約引用で OK
- `*_log.md` は決定事項・作業ログ・引継ぎコンテキスト
- `*_outbox.md` は使わない

### 機密保持
- `.env` 内容、API キー、トークン、Webhook URL、個人情報を mirror ファイルに書かない
- 本ログにも書いていない

### 返信スタイル
- 結論ファースト、段階深掘り
- 中立フラット評価（盲信せず）
- 推測と確定情報を分ける
- 過剰実装しない、シンプル指向

### Z: ドライブ実行ルール
- Codex desktop sandboxed shell で `Z:\` パスが working dir として使えない場合あり
- `CreateProcessWithLogonW failed: 267` 等が出たら **sandbox 問題を最初に疑う**
- 絶対パス `Z:\...` を引数として渡し、ローカル作業ディレクトリから実行する

---

## 補足追加候補（必要なら）

- `docs/foreground-service.md` — 背景録音の Android 実装ガイド（未作成）
- `docs/cloudflare-deployment.md` — Worker デプロイの詳細ステップ（worker/README.md に集約済）
- `client/src/lib/managed.js` — クライアント側の Worker 経由判定（現状はサーバ側 `services/managed.js` のみ、mobile では client 側にも必要）
- `electron/index.cjs` への asar 例外設定 — sql.js wasm の正しい場所
- `tests/` — 単体・統合テスト（現在ゼロ）

---

## 2026-05-12 Codex 追記: LLM候補の再確定

ユーザー指定に合わせ、公式ページ確認後にモデル候補を会社別で再固定した。

- OpenAI: `gpt-5-nano` を最安として残す。標準は `gpt-5.4-mini`、ハイエンドは `gpt-5.4`。
- Gemini: 最安 `gemini-2.5-flash-lite`、標準 `gemini-3.1-flash-lite`、ハイエンド `gemini-3.1-pro-preview`。
- Claude: 標準 `claude-haiku-4-5-20251001`、ハイエンド `claude-sonnet-4-6`。
- Grok: 標準/ハイエンド `grok-4.3`、長文向け `grok-4.20-0309-reasoning`。
- 旧/除外モデルはDB設定・テンプレート・refine_preferenceで現行モデルへ移行する。

変更箇所:
- `client/src/lib/models.js`
- `client/src/pages/Settings.jsx`
- `server/config/tiers.js`
- `server/db/database.js`
- `server/services/summary/gemini.js`
- `server/services/summary/claude.js`
- `server/services/refine.js`
- `server/services/text-parser.js`
- `worker/src/middleware/model-guard.ts`

検証:
- `npm.cmd run build --prefix Z:\projects\voicescape` 成功（Viteの500kB超chunk警告のみ）
- `node --check` 成功: `server/db/database.js`, `server/config/tiers.js`, `summary/gemini.js`, `summary/claude.js`, `refine.js`, `text-parser.js`
- `npx.cmd tsc --noEmit` 成功（worker）

---

## 2026-06-24 Codex 追記: 文字起こし一括txt出力

ユーザー依頼により、VoiceScope本番データDBから全文字起こしをtxtへ一括出力した。

- 参照DB: `C:\Users\tka89\AppData\Roaming\VoiceScope\data\voicescope.db`
- 出力先: `Z:\projects\voicescape\exports\transcripts_20260624094647`
- `latest`: 録音IDごとの最新文字起こし。整形済みがあれば `refined_segments_json` を優先。
- `all_versions`: `transcriptions` テーブル全50履歴をすべて出力。
- 件数: latest 39件、all_versions 50件、空ファイル0件。
- DB状況: recordings 38件、transcriptions 50件、録音レコードに紐づかない古い文字起こし履歴2件あり。漏れ防止のため出力対象に含めた。

追加した再利用用スクリプト:
- `scripts/export-transcripts.mjs`

実行コマンド:
- `node "Z:\projects\voicescape\scripts\export-transcripts.mjs"`

---

## 2026-07-02 Codex 追記: 抜本見直し用AI引き継ぎ文

ユーザーが他AIにもVoiceScopeをレビューさせたいとのことで、細かな改善ではなく「ほぼ作り直し前提」の抜本レビュー用プロンプトを作成した。

作成ファイル:
- `state/rebuild_handoff_prompt.md`

プロンプトの主旨:
- 既存実装の延命ではなく、スマホ対応とローカル保存を軸に再設計する。
- 特にスマホで録音・文字起こし・要約データをローカル保存できることを差別化要素として重視。
- ローカル処理（whisper.cpp / faster-whisper / Ollama / ローカルエンドポイント）のエラーが多い点を抜本設計課題として扱う。
- Capacitor / React Native / Flutter / PWA / ネイティブ等を現在の公式情報で比較させる。
- 小さなUI修正やバグ修正リストではなく、アーキテクチャ、データ保存、移行、ローカルAI、ロードマップの判断材料を出させる。