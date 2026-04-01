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

## Phase 2: Electron化 — 進行中 🔧

### 完了
- [x] Electronメインプロセス（main.cjs）
- [x] Preloadスクリプト（contextBridge IPC）
- [x] サーバーマネージャー（fork子プロセスでExpress起動）
- [x] Electron Store（APIキー暗号化保存）
- [x] システムトレイ（録音状態表示、コンテキストメニュー）
- [x] グローバルショートカット（Ctrl+Shift+R で録音トグル）
- [x] 会議アプリ検知モジュール（Zoom/Teams/Discord/Slack/Webex）
- [x] desktopCapturer API設定（ダイアログなしシステム音声）
- [x] 設定画面のElectron対応（APIキー直接入力UI）
- [x] 録音ボタンのElectron IPC連携（ショートカット＆トレイ同期）
- [x] electron-builder設定（NSIS Windows .exe）

### 未対応
- [ ] .exeビルドテスト（ローカル環境でのビルド実行）
- [ ] 初回セットアップウィザード（APIキー設定フロー）
- [ ] 会議アプリ検知 → 自動録音開始のUI統合

### LLMモデル設定（最新版）
- Gemini: gemini-3.1-flash-lite-preview（デフォルト）
- Grok: grok-4-1-fast-non-reasoning
- OpenAI: gpt-5.4-nano

## 最終更新: 2026-04-01
