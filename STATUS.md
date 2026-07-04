# VoiceScope — 進捗状況

## Phase 1 MVP — 完了 ✅

### 完了項目
- [x] プロジェクト基盤（Vite + React + Express + Tailwind CSS）
- [x] データベース層（sql.js + SQLiteスキーマ + シードデータ）
- [x] バックエンドAPI（録音CRUD、テンプレートCRUD、タグ管理、設定）
- [x] 文字起こしサービス（Deepgram / Whisper 切替対応）
- [x] 要約サービス（Gemini / Grok / OpenAI 切替対応）
- [x] 自動パイプライン（アップロード → 文字起こし → 要約 → タグ提案）
- [x] ダッシュボード（録音一覧、検索、タグフィルタ、D&Dアップロード）
- [x] 録音詳細画面（プレーヤー、文字起こし表示、要約表示、タグ編集）
- [x] テンプレート管理画面（CRUD、プロンプト編集、テスト実行UI）
- [x] 設定画面（エンジン/LLM/言語の設定）
- [x] ブラウザ録音（マイク + システム音声キャプチャ）
- [x] フローティング録音ボタン（波形ビジュアライザー付き）
- [x] Docker構成（Dockerfile + docker-compose.yml）
- [x] PWAマニフェスト + Service Worker
- [x] 音声再生位置と文字起こしテキストの自動スクロール連動
- [x] 文字起こしテキストのインライン編集
- [x] テンプレートのテスト実行UI

## Phase 2: Electron化 — 完了 ✅

### 完了項目
- [x] Electronメインプロセス（main.cjs）
- [x] Preloadスクリプト（contextBridge IPC）
- [x] サーバーマネージャー（spawn子プロセスでExpress起動、ELECTRON_RUN_AS_NODE）
- [x] Electron Store（APIキー暗号化保存）
- [x] APIキーのランタイム更新（POST /api/settings/api-keys）
- [x] セットアップウィザード（初回起動時APIキー設定フロー）
- [x] システムトレイ（録音状態表示、コンテキストメニュー）
- [x] グローバルショートカット（Ctrl+Shift+F8 で録音トグル）
- [x] 会議アプリ検知モジュール（Zoom/Teams/Webex/Google Meet/Discord Voice）
- [x] desktopCapturer API設定（ダイアログなしシステム音声）
- [x] 設定画面のElectron対応（APIキー直接入力UI、即時反映）
- [x] 録音ボタンのElectron IPC連携（ショートカット＆トレイ同期）
- [x] electron-builder設定（NSIS Windows .exe、asar無効）
- [x] ローディング画面（サーバー起動待機中に表示）
- [x] .exeビルド＆パイプライン動作確認済み
- [x] エラーバナー＆再処理ボタン（パイプラインエラー時の可視化）
- [x] 要約のコピー＆Markdownエクスポート
- [x] 文字起こしテキストのコピー
- [x] 全体Markdownエクスポート（要約+文字起こし一括ダウンロード）
- [x] 削除確認ダイアログ（ConfirmDialogコンポーネント）
- [x] 話者ラベル編集（カラーバッジ、オートコンプリート付き）
- [x] UIテーマ変更（グレーベース、フォント縮小、余白追加）
- [x] 録音タイトル自動生成（LLMで文字起こし内容から生成）
- [x] 録音モード選択（マイクのみ / マイク+デスクトップ音声）
- [x] Google Meet検知（Chrome窓タイトルベース）
- [x] Discord音声チャンネル検知（ローカルIPC RPC）
- [x] 音声エクスポート先設定UI（フォルダ選択、自動コピー）
- [x] Deepgram単語レベルセグメント分割（話者変更/休止/時間ベース）
- [x] AI質問機能（単一録音チャット、会話履歴対応）
- [x] ハイライト記録（Ctrl+Shift+Q / ★ボタン、文字起こしに黄色マーカー表示）
- [x] 録音中テキストメモ（📝ボタンでタイムスタンプ付きメモ追加、文字起こしに表示）
- [x] タスク抽出テンプレート（TODO/アクションアイテム/決定事項の自動抽出）
- [x] 感情・トーン分析テンプレート（スタンス/感情変化/関係性の分析）

## Phase 3: ローカルモード — 完了 ✅

### 完了項目
- [x] Ollama対応（ローカルLLM要約プロバイダー、OpenAI互換API経由）
- [x] faster-whisper対応（ローカル文字起こしエンジン、Pythonサブプロセス）
- [x] Pythonワーカースクリプト（faster_whisper_worker.py、--check/--audio対応）
- [x] ローカルサービス検出API（GET /api/local-status、Ollama/faster-whisper可用性チェック）
- [x] 設定画面UI更新（ローカルサービスステータス表示、クラウド/ローカル切替、Whisperモデル選択、Ollamaモデル一覧）
- [x] whisper.cpp対応（バイナリ自動ダウンロード、Pythonなしでローカル文字起こし）
- [x] whisper.cppセットアップUI（ワンクリックでバイナリDL、モデルDLボタン）
- [x] OllamaモデルPull UI（設定画面からモデル名入力→ダウンロード）
- [x] ダウンロード進捗のリアルタイムポーリング表示

### LLMモデル設定（最新版）
- Gemini: gemini-3.1-flash-lite（デフォルト）
- Grok: grok-4.3
- OpenAI: gpt-5.4-nano
- Ollama: ユーザーがpullしたモデルから選択

### Whisperモデル設定
- tiny / base（デフォルト）/ small / medium / large-v3

## セキュリティ強化 — 完了 ✅

### 完了項目
- [x] CORS制限（localhostオリジンのみ許可）
- [x] サーバーlocalhostバインド（127.0.0.1のみ）
- [x] APIトークン認証（Electron起動時にランダム生成、全APIリクエストに付与）
- [x] 暗号化キーのマシン固有化（ハードコード除去、既存データ自動移行）
- [x] Markdownサニタイズ（rehype-sanitize導入、XSS防止）
- [x] レート制限（express-rate-limit、AI系エンドポイント10回/分）
- [x] エクスポートパスバリデーション（正規化+存在確認）
- [x] 設定キーホワイトリスト（PATCH /api/settingsの不正キー拒否）
- [x] DevTools制御（本番では--devフラグ時のみ有効）
- [x] ファイル名UUID追加（タイムスタンプ衝突防止）
- [x] disable-gpu-sandbox条件付き適用（--disable-gpu-sandboxフラグ時のみ）
- [x] IPC store:get/set キーホワイトリスト（APIキー不正取得防止）
- [x] Docker環境での /api/settings/api-keys 無効化（ELECTRON_MODE必須）
- [x] Ollama URL localhost制限（SSRF防止）
- [x] audioパストラバーサル防御（safeAudioPath関数）
- [x] エラーメッセージから内部パス除去（ログのみに出力）
- [x] Electronナビゲーション制限（外部リンクはデフォルトブラウザで開く）
- [x] アップロードエンドポイントにレート制限（5回/分）
- [x] limit/offsetパラメータのバリデーション（正の整数、上限200）
- [x] electron-builder v25→v26.8.1 アップグレード（依存脆弱性解消）
- [x] 旧暗号化キーのソース難読化（Base64化+TODO削除予定マーク）
- [x] helmet導入（セキュリティヘッダー: CSP, X-Frame-Options, etc.）

## 抜本見直し（2026-07-03）— 方針転換

`state/rebuild_handoff_prompt.md` に基づく抜本レビューを実施。結果は `docs/rebuild-review-2026-07.md`。

- 判断: **部分作り直し**
- PC版（Electron）は凍結保守（新機能停止、重大バグのみ）
- スマホ版は Capacitor 路線を破棄し **Expo (React Native) で新規構築**
- worker/ は Phase R0 で即デプロイ
- faster-whisper（Python経路）は廃止予定
- Bami回答済み: 実機=OPPO Pad Air(OPD2102A) / iOSもやる(iPhone 11) / 録音3時間必要 / PC版ローカルエラーは whisper.cpp 長尺OOM と特定
- **Phase R0 実装ブリーフ発行済み**: `docs/briefs/phase-R0-brief.md`（Workerデプロイ / whisper.cpp応急修理 / Expo録音PoC / iOS調査）
- **Phase R0 夜間作業実施（2026-07-03深夜）**: Bamiの明示指示により **Claude Code が例外的に実装を担当**（通常はCodex。CLAUDE.mdの例外規定に基づく記録）
  - Scope B: whisper.cpp修理 **完了・受け入れ合格**。真の原因は spawn の**30分固定タイムアウト**（メモリ枯渇ではない）。チャンク分割+ストール検知に置換。失敗していた66分実録音×large-v3が完走（54分・タイムスタンプ実長一致）、3.5時間実録音×tinyも13分で完走
  - Scope A: **Workerデプロイ完了（2026-07-03朝）**。本番URL `https://voicescope.voicescope.workers.dev`、KV作り直し（旧IDは実在せず）、スモーク全通過。残: .envのDEEPGRAM/GEMINIキー記入→deploy.ps1再実行、Electron E2Eはv0.18.1ビルド後
  - Scope C: Expo録音PoC雛形完成（実行場所は `C:\projects\voicescape-poc\expo-recorder`、NAS上でのnpm禁止）
  - Scope D: iOS調査完了（EAS BuildでMac不要、Apple Developer $99/年がR1前に必要）
  - 結果詳細: `docs/poc-r0-results.md`
- **E2Eで発覚した2バグを修正（v0.18.2、2026-07-03夕）**: ①再文字起こしがHTTP同期実行で終端ステータスに到達せずUIが永遠に待つ→バックグラウンドパイプライン化 ②Ollama要約の空応答=thinkingモデルの思考が生成予算を食い潰し+num_ctx 4096で長文切り捨て→/api/chat・think:false・num_ctx自動設定に変更。26,000字×26Bで33秒要約を実証。詳細は state/claude_log.md
- TBD: Bamiの日常スマホ機種（R1主ターゲット判定用）

## 最終更新: 2026-07-03
