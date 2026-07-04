# Claude Log

このファイルはプロジェクトの **決定事項・作業ログ・引き継ぎコンテキスト** を蓄積する場所。
セッション固有の最終返信は `claude_reply.md` 側に保存する。

---

## 2026-07-03 セッション: 抜本レビュー実施（rebuild_handoff_prompt への回答）

### 成果物
- `docs/rebuild-review-2026-07.md` — 抜本レビュー文書（総評/アーキ案/技術選定/データ移行/ローカルAI/ロードマップ/残す・捨てる判断）

### 結論（詳細は文書参照）
- **判断: 部分作り直し**
  - PC版（Electron+Express+React+sql.js）は凍結保守。作り直さない、新機能も追加しない
  - スマホ版は **Capacitor 路線を破棄し、Expo (React Native) で新規構築**
  - worker/ はそのまま採用、Phase R0 で即デプロイ
  - 共有ロジックは `packages/core`（TS、プラットフォーム非依存）に集約
- **Capacitor破棄の根拠**: 「client/ 90%再利用」前提が崩れている。アプリの頭脳は server/（8,000行、Node必須）にあり、スマホでは全て書き直し。デスクトップUIもスマホUXに不適。残る再利用資産（プロバイダロジック/スキーマ/プロンプト）は RN でも同様に活きる
- **ローカルAI再設計**: faster-whisper（Python経路）廃止。PC=whisper.cpp 1本、スマホ=whisper.rn 1本（検証週で sherpa-onnx/ReazonSpeech 系と比較）。ネイティブ録音の m4a 直保存で webm 変換問題を構造的に排除。silent fail 禁止・フォールバックは「提案」方式
- **データ**: 既存 voicescope.db は動かさない（PC版継続稼働で移行不要）。交換形式「VoiceScopeアーカイブ(zip: manifest+jsonl+audio)」をv1定義し、バックアップ/移行/PC連携の背骨にする
- **事業評価（率直）**: 「スマホ×ローカル保存」単独では差別化に不十分（Pixel/iPhoneのOS標準文字起こしが脅威）。差別化は4本束ね: データ完全所有 × テンプレ資産 × PC/スマホ横断アーカイブ × 身内おまかせ配布。規模感は「身内課金が回れば上出来」で固定費を統制

### ロードマップ（ゲート付き）
- R0（1週）: Workerデプロイ + Expo録音PoC（実機60分バックグラウンド）+ オンデバイスSTT計測
- R1（2〜4週）: モバイルMVP（画面4枚）。ゲート: Bamiが2週間スマホ版だけで運用できる
- R2（+2〜4週）: 友人ベータ。ゲート: 非エンジニアが質問ゼロで使える
- R3: PCアーカイブ連携 / Play配布 / iOS / 端末内LLM要約 / 課金は実需確認後

### Bami確認待ち（4点）
1. 検証用 Android 実機の機種
2. iOS の優先度（当面 Android のみで良いか）
3. 録音の典型尺（1時間会議か3時間配信か）
4. PC版「凍結保守」の合意

### 次のアクション
- Bami回答後、R0 の Codex 向け実装ブリーフ（`docs/briefs/phase-R0-brief.md`）を作成

### 追記（同日）: Bami回答4点 → R0ブリーフ発行

- 回答: Android実機=OPPO Pad Air OPD2102A（SD680/4GB/Android 13タブレット）/ iOSもやる（iPhone 11実機）/ 録音尺3時間必要 / PC版ローカル処理はエラー中
- **PC版エラーの原因特定**（`%APPDATA%\VoiceScope\logs\server-2026-06-24.log` 直接調査）:
  - whisper.cpp が large-v3（3094MB）を CPU・5 beams + best of 5 で実行、66分録音（3952秒）の進捗25〜50%で code null（シグナル死=メモリ枯渇濃厚）×6回。GPU（RTX 5070 Ti）未使用
  - Ollama 側のエラーはログに皆無。「ローカルLLMでエラー」の実体は文字起こし側
  - Ollama 本体は稼働確認済み（v0.30.10、qwen3:14b / gemma4 系など複数モデルあり）
- 設計への反映:
  - 3時間要件 → オンデバイスSTTは「短尺メモ用」に降格見込み。長尺ローカルの本命は自宅PC(GPU)オフロード、優先度 R3→R2 へ
  - iOS 確定 → Expo 採用をさらに補強。Apple Developer Program（年額約1.5万円）の加入判断が R1 前に必要
  - Pad Air は録音メカニクス検証用。性能判定の基準端末にしない。日常持ち歩くスマホの機種は TBD（Bamiに確認中）
- **発行: `docs/briefs/phase-R0-brief.md`**（Scope A: Workerデプロイ / B: whisper.cpp 長尺クラッシュ応急修理=凍結保守の重大バグ扱い / C: Expo録音PoC on Pad Air / D: iOS段取り調査）
- レビュー文書 §9 を回答確定版に更新済み

### 追記（同日深夜）: R0夜間実装（Claude Code実装例外・Bami明示指示）

Bami就寝前の「あなたが実装して可能な限り進めて」の明示指示により、Claude Code が例外的に実装を実施。STATUS.md に例外記録済み。

**Scope B（whisper.cpp修理）— 実装完了:**
- **根本原因を訂正**: メモリ枯渇ではなく、whisper-cpp.js の spawn オプション `timeout: 1800000`（30分固定）が犯人。CPUのlarge-v3は約実時間でしか処理できず、30分超の録音は必ず途中kill（=code null）
- 併発バグも発見: `--output-json` の出力先が非WAV入力で不一致（一時WAV側に出るのに元パス+.jsonを読んでいた）+ `--no-timestamps` がフォールバック正規表現を殺していた → 非WAVの解析失敗の一因
- 修理: ①30分タイムアウト除去→無応答10分のストール検知 ②ffmpeg segmentで10分チャンク分割→タイムスタンプオフセット連結 ③`-of`でJSONパス明示 ④チャンク境界のタイムスタンプクランプ ⑤エラーに回復手段明記 ⑥ffmpeg無し環境は従来の単一パス
- テスト: 3.5時間実録音(12,583秒)×tiny → **13分で完走**(2,491セグメント・末尾実長一致)。66分×large-v3（元の失敗ファイル）は朝完走見込みで実行中
- 変更ファイルは `server/services/transcription/whisper-cpp.js` のみ。未コミット（リポジトリに5月からの大量未コミット変更が既にあるため、コミット整理はCodex/Bami判断に委ねる）

**Scope A — deploy.ps1 準備完了（デプロイ自体は朝）:**
- wranglerログイン失効（対話認証必要）のため夜間実行不可
- `worker\deploy.ps1` を作成: ログイン→.envからシークレット投入（GEMINI_API_KEY→GOOGLE_GEMINI_API_KEYマッピング、ANTHROPIC_API_KEYは.envに無くスキップ）→JWT_SECRET生成（既存保持）→コードseed（VSTEST2026/VSFRIEND2026）→デプロイ→スモーク（health/verify/chat=gpt-5-nanoはtrial許可リスト整合確認済み）

**Scope C — Expo PoC雛形完成:**
- 実行本体: `C:\projects\voicescape-poc\expo-recorder`（**NAS上npm installはSMBロックで壊れることを実証** → ローカル必須。electron-builderと同じ教訓）
- expo-audio + expo-sqlite + expo-file-system(legacy API)。録音/保存/一覧/削除、Android権限・iOS UIBackgroundModes設定済み
- `npx expo export --platform android` でバンドル成功確認。ソースはリポジトリ `poc/expo-recorder/` に同期済み
- 実機手順は `poc/expo-recorder/README-poc.md`（Expo Go 15分→dev build→whisper.rn の3段階）

**Scope D — iOS調査完了**: EAS BuildでMac不要。実機配布はApple Developer Program（$99/年）必須（無料Apple IDはMac+7日失効で実質不可）。Expo Goのみ無料で前面録音確認可。R1着工時に加入判断

### 追記（同日夕）: E2Eで発覚した2バグの修正（v0.18.2）

BamiのE2Eテストで2件の不具合報告 → Claude Codeがデバッグ・修正（実装例外の継続）。

**バグ1: 再文字起こし後にUIが更新されず「ずっと待つ」**
- 真因: `POST /:id/transcribe` だけが**HTTPリクエスト内で文字起こしを同期実行**（54分）し、完了後も status='transcribed' のまま**終端ステータス(completed)に到達しない**設計だった（アップロード経路はrunPipelineバックグラウンド+即応答なのに、再文字起こしだけ旧設計）
- 修正: 再文字起こしも `runPipeline` バックグラウンド起動+202即応答に統一（`skipSummary:true` で既存要約は保持、refine実行後 completed で終端）。`pipeline.js` に engine/language/diarize のパススルーを追加
- クライアント側は無変更でOK（トーストは元々「開始しました」表記、2秒ポーリングが遷移を拾う）

**バグ2: Ollama要約「空の応答が返されました」**
- 真因: gemma4-turbo/qwen3等の**thinkingモデル**は応答が`reasoning`と`content`に分離され、長文入力では生成予算を思考で使い切り**contentが空**になる。再現実験で確定（26Bモデル: 思考262トークン+回答ギリギリ）。さらにOllamaのデフォルトnum_ctx(4096)が長文を無言で切り捨てていた
- 修正: `summary/ollama.js` をOpenAI互換`/v1`からネイティブ`/api/chat`に切替。①`/api/show`でthinking capability検出→`think:false`送信（実測: 思考0トークン・content正常） ②num_ctxを入力長に応じて自動設定(8192〜32768) ③num_predict=4096 ④タイムアウト600秒 ⑤エラーメッセージに対処法明記
- 波及効果: offline処理モードでは refine / タイトル生成 / タグ付け / Ask も同関数経由のため全て直る
- 検証: 短文×26B think:false → content正常・thinking 0。**26,000字実文字起こし×26B → 33秒で1,230字の要約生成に成功**（prompt 13,919トークン全量がctx内、切り捨てなし、done_reason=stop）
- リリース: v0.18.2（package.json + sw.js CACHE_NAME更新済み）

**残タスク（朝以降）:**
1. Bami: `worker\deploy.ps1` 実行（ブラウザでAllow 1クリック）→ Electronでコード `VSTEST2026` E2E
2. 66分×large-v3 の完走確認 → `docs/poc-r0-results.md` 最終更新（Claude が続き対応）
3. Bami+伴走: Pad Air で Expo Go テスト（15分）→ dev build 60分バックグラウンドテスト
4. Bami: 日常スマホの機種を回答（R1主ターゲット）
5. PC版のリリース（バージョンバンプ+SW CACHE_NAME+update.cmd）はwhisper修理の検収後

---

## 2026-04-29〜30 セッション: gpt-image-2 統合 + 致命バグ駆除

### バージョン履歴
- `0.15.4` → `0.17.1` まで連続リリース

### 主要な意思決定

#### 1. インフォグラフィック生成モデル: **gpt-image-2 のみ採用**
- 当初 `gpt-image-1` で実装したが、日本語テキスト描画が破綻するため不採用
- `gpt-image-1.5` も同様に不採用（ユーザー判断）
- gpt-image-2 は **OpenAI Verified Organization 限定**：個人ユーザーは身分証認証が必要
- 副次効果: 「API 認証の面倒さ → おまかせプランへの導線」として戦略的に活用する方針

#### 2. デフォルト品質: **`low` ($0.006/枚)**
- 実測で日本語テキストも十分なクオリティ
- `auto` はコストが読めない（最大35倍ブレ: $0.006〜$0.211）
- 高品質はユーザー明示オプトインに

#### 3. 配布アーキテクチャ判断（保留）
3案を比較:
- **A. fal.ai 一本**: gpt-image-2 直接 + LLM プロキシ、ユーザー登録1箇所
- **B. Cloudflare Worker（既存 Phase 3 計画）**: 自前運用、マークアップなし、運営側で組織認証1回
- **C. 現状維持（マルチプロバイダ直契約）**: 最安だが認証地獄
- ユーザー方針: 「個人で組織認証 OR 有料プラン」の二択 → 案B が本命だが判断は保留

#### 4. プラン構成の方向性
| プラン | 月額 | API登録 | 認証 | 画像生成 |
|---|---|---|---|---|
| 自前APIキー | ¥0 | 自前 | ユーザー側 | gpt-image-2（自身のキー） |
| 自前+ローカル | ¥0 | 不要 | 不要 | 非対応 |
| おまかせ Pro | ¥980 | 不要 | 運営側 | 標準 |
| おまかせ Heavy | ¥2,480 | 不要 | 運営側 | 全部 |

### 駆除した致命バグ

#### sql.js の `last_insert_rowid() = 0` 問題
- **症状**: INSERT 後の `lastInsertRowId()` が 0 を返し、UPDATE WHERE id=0 が空振り → DB に空 paths が残る
- **原因**: sql.js の `db.export()`（save() 内で呼ばれる）が **DB 接続を一度閉じて再オープン**するため `last_insert_rowid()` がリセット
- **修正**: 新ヘルパー `executeReturningId(sql, params)` を追加。`db.run()` 直後・`save()` 前に rowid を取得
- **影響範囲**: 5箇所修正（infographics、infographic_presets、summaries、tags x2、templates）— 過去ずっと壊れていた可能性大

#### Service Worker キャッシュ固定化
- **症状**: 再ビルドしても古い UI が表示され続ける
- **原因**: `CACHE_NAME = 'voicescope-v1'` が固定で、`activate` で古いキャッシュを掃除できない
- **修正**: バージョン文字列を含めたキャッシュ名（毎リリース更新）+ HTML を network-first に変更

#### ファイル名衝突（DB リセット時の上書き）
- **症状**: 過去の gpt-image-1 画像が消える
- **原因**: ファイル名が `rec_<recId>_ig_<rowId>_<n>.png` で、DB リセット時に rowid が再生成され同名で上書き
- **修正**: ミリ秒タイムスタンプを追加 `rec_<recId>_ig_<rowId>_<timestamp>_<n>.png` + `existsSync` ガード

#### TDZ クラッシュ（v0.17.0 → 0.17.1 で修正）
- **症状**: アプリ起動時に灰色画面（React マウント失敗）
- **原因**: Dashboard.jsx で `pendingInfographics` の宣言（line 150）より前の useEffect（line 92）で参照
- **修正**: 宣言を `addToast` 直後に移動

### 安全装置の追加

- **`index.html` に 5秒ウォッチドッグ**: React がマウントしなければリカバリパネルを自動表示
- **緊急リカバリボタン**: SW 全削除 + Cache Storage 全削除 + キャッシュバスト URL でリロード
- **MutationObserver**: マウント検知で誤検出防止
- **サーバログのファイル永続化**: `%APPDATA%\VoiceScope\logs\server-YYYY-MM-DD.log`

### UI/UX 改善

- インフォグラフィック専用タブ（要約タブから分離）
- モーダル冒頭に組織認証案内バナー（黄色）
- 構造化LLMの可視化（gemini / gemini-3.1-flash-lite-preview を表示）
- アスペクト比に **真の 9:16 / 16:9 / 4:5** 追加
- リファレンス画像のプリセット保存（ブランドキット）
- エクスプローラ「画像の場所」ボタン
- 自動エクスポートフォルダ機能（`EXPORT_INFOGRAPHIC_PATH`）
- **画像クリックで拡大ライトボックス**（DL/場所/コピーボタン付き、Esc で閉じる）
- **ダッシュボードに 🎨 N バッジ**（生成済み枚数表示）
- **生成中インジケーター**（パルスアニメ + 経過秒数）— 非同期化で UI 固定化を解消

### 構造的な変更

- `client/src/components/ImageLightbox.jsx` 新規追加
- `client/public/sw.js` 全面書き直し（network-first for HTML, version-based cache）
- `server/db/database.js` に `executeReturningId` 追加
- `server/services/infographic/{generator,structurer,styles}.js` 新規
- `server/routes/infographic.js` 新規
- `client/src/components/InfographicModal.jsx` 新規（2段階フロー: structure → generate）
- `electron/server-manager.cjs` にログファイル書き出し追加
- `update.cmd` 新規（build + silent install + launch のワンショット）
- `build-exe.cmd` に `--no-pause` / `--no-explorer` フラグ追加

### 未完タスク・引き継ぎ事項

1. **配布アーキテクチャの確定**（fal.ai vs Cloudflare Worker vs 現状）
2. **プラン UI 実装**（設定画面に料金プラン枠、トライアルコード入力）
3. **Cloudflare Worker 実装**（おまかせプランの実体、既存 Phase 3 計画）
4. **プリセット動作確認**（ブランドキットの実運用テスト）
5. **STATUS.md への VoiceScope エントリ追加**（横断参照のため）
6. **バンドルサイズ警告**: client bundle が 607KB（gzip 175KB）。code-splitting 検討余地あり

### Worker 着手時の参考順序（既存 Phase 3 計画より）

1. Worker scaffolding + `/verify` + `/v1/chat/completions`
2. `/v1/messages` + `/v1/transcribe`
3. KV にコード seed + deploy
4. `server/services/managed.js` 新規
5. プロバイダファイル変更（openai / grok / claude / deepgram）
6. `settings.js` activate-trial を Worker 連携に変更
7. CSP + tiers.js 更新
8. テスト + バージョンバンプ

---

## 2026-05-02 アーキテクチャ判断: Android モバイル版の検討

### ユーザー提案
「超大型改修。なんならフォーク開発の方が良いレベル。これ、スマホアプリに出来ませんか？開発環境的にAndroid限定でいいです。」

### 結論
**Capacitor 採用 + monorepo 化**を推奨として提示。

### 比較した5案
| 案 | 工数 | コード再利用率 | 評価 |
|---|---|---|---|
| **Capacitor** | 1〜2週でPoC | **90%+** | 🥇 推奨 |
| React Native | 1〜2ヶ月 | UI 0% | × 工数過多 |
| PWA のみ | 数日 | 100% | △ バックグラウンド録音不可 |
| Tauri Mobile | 中 | 80% | × Android 不安定 |
| ネイティブ Kotlin | 3〜6ヶ月 | 0% | × |

### サーバ構造の3案
- **A. 純クライアント化**（API キー端末内、簡素）
- **B. NAS/PC をサーバとして利用**（自宅LAN前提）
- **C. Cloudflare Worker 経由**（既存 Phase 3 計画と一致）

→ **C 案推奨**。モバイル化と Worker 化のタイミングを揃えると一石二鳥。

### フォーク方針
**monorepo 案**を推奨:
```
Z:\projects\voicescape\
  ├── client/         共通 React
  ├── server/         Electron 版用
  ├── electron/       デスクトップ
  ├── mobile/         Capacitor + Android（新規）
```

### モバイル版で発生する完全新規実装
- バックグラウンド録音（Foreground Service + 通知バー）
- ギャラリー保存（MediaStore API）
- データ容量管理 UI
- Wi-Fi 限定オプション
- 署名鍵生成 + APK 配布 or Play Console

### 段階移行プラン
| Phase | 工数 | 内容 |
|---|---|---|
| 0 | 1〜2日 | Capacitor 初期化 + エミュレータ起動 |
| 1 | 1週間 | コア機能（録音 / 文字起こし / 要約） |
| 2 | 1〜2週間 | モバイル特化（バックグラウンド / ギャラリー保存 / 通知） |
| 3 | 数日 | 署名 + 配布 |

合計 **2〜4週間で Android MVP**。

### 提示した着手順序の選択肢
- **A. Worker 先行**（既存 Phase 3 → その後モバイル）
- **B. モバイル PoC 先行**
- **C. 両方並行**

ユーザー判断待ち。

### 必要な開発環境
- Android Studio (Windows対応、メインPC で問題なし)
- JDK 17+ (Android Studio 同梱)
- Capacitor CLI
- 物理端末 or Emulator
- Play Console（配布時、$25一回払い）

---

## 2026-05-02 (続き) Worker + Mobile 並行スキャフォールド完了

### 決定事項
- 着手順序は **C 案（両方並行）** で進行
- Cloudflare Worker サブドメイン: `voicescope` (旧 `voicescope-api` から rename)
- → 新 URL: `https://voicescope.tka1478.workers.dev`
- パッケージ名: `com.bamipeko.voicescape`
- Android 開発環境: Sumika (Flutter) と Android Studio / SDK / JDK / AVD を共有
- 物理端末は未準備のためエミュレータで進める

### Worker 完了内容
- `worker/src/routes/images.ts` 新規 — gpt-image-2 generations + edits プロキシ
- `worker/src/routes/gemini.ts` 新規 — Google Gemini プロキシ
- `worker/src/middleware/model-guard.ts` 拡張:
  - `IMAGE_PRO`/`IMAGE_HEAVY` で gpt-image-2 を tier 別管理
  - Gemini モデルを各 tier に追加
- `worker/src/index.ts` リライト — 全エンドポイント登録
- `worker/wrangler.toml` Worker name を `voicescope` に変更
- `worker/README.md` 新規 — デプロイ手順、シークレット投入、テスト手順、料金見積

### Mobile 新規 scaffold
- `mobile/package.json` — Capacitor 7 + 必要プラグイン
  (sqlite/filesystem/preferences/network/share/status-bar/toast/app)
- `mobile/capacitor.config.ts` — appId / appName / webDir / Android 設定
- `mobile/.gitignore`
- `mobile/README.md` — bootstrap, 権限設定, dev loop, APK ビルド, 署名, トラブルシュート

### 共通基盤 (client/src/lib/)
- `platform.js` 新規 — Electron / Capacitor / Browser 検出 + capability flags
- `storage.js` 新規 — KV ストレージ抽象化 (electron-store / Preferences / localStorage)
- `localEndpoint.js` 新規 — ローカルLLMエンドポイント設定 + 5プリセット
  - 自宅PC Ollama (LAN/Tailscale)
  - NAS Ollama
  - コンパニオン Android アプリ (Maid/Layla/MLC Chat)
  - Termux + Ollama
  - カスタム

### サーバ更新
- `server/services/managed.js` — DEFAULT_WORKER_URL を新サブドメインに

### 新規ドキュメント
- `ROADMAP.md` 新規 — 3ターゲットアーキテクチャ図 + プラン構成 + Phase 1/2/3 タスク
- `Z:\projects\STATUS.md` に VoiceScope エントリ追加

### ユーザー確認事項
- Cloudflare アカウント: tka1478 (既存)
- wrangler login: 完了済み
- API キー: 既存 .env から流用可能
- Android Studio: Sumika で既にインストール済み（共用OK）
- 物理端末: 用意しない、エミュレータのみ
- パッケージ名: `com.bamipeko.voicescape` 確定
- Play Console: 後回し

### Phase 1 残タスク
1. `wrangler deploy` で Worker 本番反映
2. シークレット投入: `wrangler secret put` × 5〜6 個
3. `npm run seed` で初期コード投入
4. Mobile: `npm install` → `npx cap init` → `npx cap add android`
5. AndroidManifest.xml に録音/通知/ストレージ権限追加
6. エミュレータ初回起動
7. DB 移行 (sql.js → @capacitor-community/sqlite)
8. Settings UI に「ローカル処理エンドポイント」追加 (`localEndpoint.js` API を呼ぶ)
