# Phase R0 実装ブリーフ — 検証週（Worker稼働 + PC応急修理 + モバイルPoC）

- 発行: 2026-07-03 / Claude Code（ディレクター）
- 実装: Codex
- 前提文書: `docs/rebuild-review-2026-07.md`（抜本レビュー。方針=部分作り直し、スマホ版はExpo/RN新規構築）
- 期間目安: 1週間
- Z:ドライブ実行ルール: `Z:\projects\AGENTS.md` / 本プロジェクト `AGENTS.md` 参照（sandbox で workdir にできない場合は絶対パス指定）

## 確定済みの前提（Bami回答 2026-07-03）

| 項目 | 回答 |
|---|---|
| Android 実機 | **OPPO Pad Air (OPD2102A)** — タブレット。Snapdragon 680 / 4GB RAM / 最大 Android 13 (ColorOS 13) / Wi-Fiのみ |
| iOS | **やる**。実機 iPhone 11 あり（A13、iOS 26 対応圏内） |
| 録音尺 | **3時間必要**。1時間では足りない |
| PC版 | ローカルLLM（実際は whisper.cpp 文字起こし）でエラー発生中 → 本ブリーフ Scope B で応急修理 |
| TBD | Bamiが日常持ち歩くスマホの機種（R1の主ターゲット判定に必要。ブリーフ実行は妨げない） |

### 録音尺3時間が設計に与える影響（実装時に意識すること)

- オンデバイスSTTは3時間音声の主経路にはならない（どの端末でも処理時間・発熱が非現実的)。役割は「短いメモの即時文字起こし」に限定される見込み
- 長尺のローカル処理の本命は**自宅PC(RTX 5070 Ti)へのオフロード**。R0ではやらないが、Scope B の修理はこの布石になる

---

## Scope A: Cloudflare Worker 本番デプロイ

コードは完成済み（`worker/`）。デプロイと動作確認のみ。

手順（詳細は `worker/README.md`）:
1. `cd worker && npm install`
2. `wrangler secret put` × JWT_SECRET / OPENAI_API_KEY / DEEPGRAM_API_KEY / ANTHROPIC_API_KEY / GOOGLE_GEMINI_API_KEY / GROK_API_KEY
3. `npm run seed`（KVへコード投入）
4. `npm run deploy`
5. 動作確認: `/health` → `/verify`（テストコード）→ JWT で `/v1/chat/completions` と `/v1/transcribe`

**受け入れ条件:**
- [ ] `https://voicescope.voicescope.workers.dev/health` が 200（サブドメインは2026-07-03に `voicescope` で登録済み）
- [ ] `/verify` でテストコードから JWT が取得できる
- [ ] JWT 付きで chat completions と transcribe が実レスポンスを返す
- [ ] 既存 Electron 版でトライアルコード入力 → おまかせモードで要約が1件成功する（E2E）
- [ ] シークレット値・コード一覧を log/reply ファイルに書かない（機密ルール）

## Scope B: PC版 whisper.cpp 長尺クラッシュの応急修理（凍結保守の「重大バグ」扱い）

### 現象（ログで確認済み: `%APPDATA%\VoiceScope\logs\server-2026-06-24.log`）

- 約66分（3952秒）の録音を model=**large-v3**（CPU 3094MB）、**5 beams + best of 5** で処理中、進捗25〜50%で子プロセスが **code null**（シグナル死、メモリ枯渇濃厚）× 6回
- エラーメッセージ「whisper.cppが異常終了しました (code null)」はユーザーに原因も回復手段も伝えない
- Ollama（要約側）のエラーはログに無し。壊れているのは文字起こしのみ

### 対応（bounded fix — これ以外のPC改修はしない）

優先順に検証して採用。①は必須、②③は効果を見て:

1. **長尺の自動チャンク分割（必須)**: 一定長（目安10〜15分）を超える音声は ffmpeg で分割 → 順次 whisper.cpp 実行 → セグメントのタイムスタンプをオフセット補正して連結。メモリ使用を録音長と無関係にする
2. **長尺時のデコード軽量化**: チャンク処理でもメモリ厳しい場合、長尺時は `--beam-size 1` 等に自動降格
3. **GPU版バイナリの評価（調査のみでも可)**: whisper.cpp 公式リリースに Windows GPU（Vulkan/CUDA）ビルドがあるか確認し、配布サイズ・依存DLL・5070 Ti での動作を評価。採用判断はディレクター検収時に協議
4. **エラーの本文化**: 失敗時に「音声が長すぎる可能性。モデルを小さくする / クラウドで再実行」の選択肢をUIに提示（既存のエラーバナー＆再処理ボタンの流儀に合わせる)

**受け入れ条件:**
- [ ] 失敗していた実録音（66分、rec_20260624100254/100255）が large-v3 で完走する
- [ ] 3時間のダミー音声（無音+スピーチ混在で生成してよい）が完走する
- [ ] 失敗時のエラーメッセージが回復手段を提示する
- [ ] SW `CACHE_NAME` / バージョン同時更新ルール遵守（リリースする場合)
- [ ] 変更範囲が transcription 経路+エラー表示に閉じている（他機能に触れない)

## Scope C: Expo 録音 PoC（OPPO Pad Air 実機）

新規 `poc/expo-recorder/` に最小 Expo アプリを作る。**本実装ではない**。画面は録音開始/停止ボタン+録音一覧だけでよい。UI磨き込み禁止。

検証項目:
1. **録音の生存性**: 画面オフ・アプリバックグラウンドで **60分録音が完走**し m4a が保存される（Foreground Service + 通知。Android 13 なので POST_NOTIFICATIONS 権限に注意)
2. **3時間録音を1回**: 完走・ファイルサイズ・電池消費をメモ
3. **割り込み耐性**: 録音中に他アプリ使用・通知・（タブレットなので着信は無し）で壊れないか
4. **expo-sqlite**: スキーマ作成→CRUD→アプリ再起動後の永続確認
5. **whisper.rn**: tiny / base モデルで5分の日本語クリップを文字起こしし、所要時間と精度感をメモ
   - 予想: Snapdragon 680 では実用外。**それ自体が正式な判定材料**なので、遅くても失敗ではない。数値を残すこと
6. （余力があれば）sherpa-onnx 系日本語モデル（ReazonSpeech 等）の RN 組み込み難易度を机上調査

**受け入れ条件:**
- [ ] Pad Air 実機で 60分バックグラウンド録音 → m4a 再生確認
- [ ] 3時間録音の結果記録（完走可否・サイズ・電池）
- [ ] whisper.rn の実測値（model / 音声長 / 処理時間 / 主観精度）が表で残っている
- [ ] 結果を `docs/poc-r0-results.md` にまとめる（判定はディレクターが行う)

## Scope D: iOS 展開の段取り調査（実装なし）

- Expo/EAS で iPhone 11 実機に載せるまでの手順・必要物を整理する:
  - Apple Developer Program（年額約1.5万円）加入の要否とタイミング（TestFlight/実機配布に必須のはず。正確な現行条件を確認)
  - Mac 非所有前提で EAS Build（クラウド）だけで回るか
  - Expo Go だけで検証できる範囲（前面録音は可 / バックグラウンド録音や whisper.rn はネイティブビルド必須のはず）
- 結果は `docs/poc-r0-results.md` に1セクションで

## やらないこと（禁止）

- モバイル本実装（apps/mobile の新設、packages/core の実装）→ R1
- PC版の Scope B 以外の改修・リファクタ
- mobile/（Capacitor scaffold）の削除 → R1 着工時に実施
- 課金・Play/App Store 関連作業

## 記録

- 進捗・発見・判断は `state/codex_log.md` に追記
- 仕様判断が必要になったら: 重要 → STATUS.md/codex_log に質問として残す。軽微 → 実装して根拠を記録
