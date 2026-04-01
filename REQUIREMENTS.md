# VoiceScope — 要件定義書

> 音声文字起こし＆AI要約セルフホストアプリ
> Plaud AI代替として個人運用（各自が各自の環境で動かす）

---

## 1. プロジェクト概要

### 1.1 目的
Plaud AIのデスクトップ/Web機能を自前で再現し、以下を実現する：
- サブスク費用の排除（APIの従量課金のみに）
- 自分好みのUI・ワークフローへのカスタマイズ
- 将来的な完全ローカルモード対応（機密情報対応）

### 1.2 ユーザーと配布方針
- **Phase 1**: 自分（Bami）のみ。NAS上Docker運用。認証不要（シングルユーザー）
- **Phase 2以降**: 友人にも配布。Electronの.exeを渡し、各自が自分のPC上で自分のAPIキーで運用
- データは各自が各自の環境で管理。中央サーバーでの一括管理はしない

### 1.3 フェーズ構成

| Phase | 内容 | アプリ形態 | 対象ユーザー |
|-------|------|-----------|-------------|
| Phase 1 | コア機能MVP | PWA（NAS上Docker） | 自分のみ |
| Phase 2 | デスクトップアプリ化 | Electron .exe | 自分＋友人 |
| Phase 3 | 完全ローカルモード | ローカルWhisper + ローカルLLM | 全員 |

本書はPhase 1の要件を定義する。Phase 2以降は別途。

---

## 2. 技術スタック

### 2.1 技術選定と根拠

| レイヤー | 選定 | 根拠 |
|---------|------|------|
| フロントエンド | React (Vite) | PWA対応、Phase 2でElectronラップ前提。Vue/Svelteでも可だが、Electronとの統合事例が最も多い |
| バックエンド | Node.js (Express or Fastify) | フロントとの統一言語、Discord Bot群との親和性、Claude Codeとの相性 |
| DB | SQLite (better-sqlite3) | NAS上の既存パターン踏襲、軽量、バックアップ容易 |
| 文字起こしAPI（メイン） | Deepgram API | 文字起こし＋話者分離がワンストップ、日本語対応、$0.0043/min〜と安価 |
| 文字起こしAPI（代替） | OpenAI Whisper API | 切り替え可能に実装（話者分離なし、必要時はpyannote併用） |
| 要約LLM | 複数切替式 | Gemini API / Grok API / OpenAI API を設定画面から選択 |
| ファイルストレージ | ローカルファイルシステム | 音声ファイル・文字起こしJSON・要約テキストをNAS上に保存 |
| デプロイ | Docker (docker-compose) | NAS上で稼働、既存インフラと統一 |

### 2.2 除外した選択肢
- **Python バックエンド**: バッチ処理には強いが、今回はリアルタイムUI配信が中心。Node.jsで統一した方がフロント〜バック間のコード共有・保守が楽
- **PostgreSQL / MySQL**: ユーザー数名規模にはオーバースペック。SQLiteで十分
- **Claude API**: コスト面で除外（既定方針）
- **Tauri**: バイナリ軽量だがRust知識が必要、Claude Codeでの実装リスク高

### 2.3 Deepgram vs Whisper API 比較

| 観点 | Deepgram | Whisper API |
|------|----------|-------------|
| 話者分離 | ○ 標準搭載（diarize=true） | × 単体不可、pyannote等が別途必要 |
| 日本語精度 | ○ Nova-2モデルで良好 | ◎ 多言語で高精度 |
| コスト | $0.0043/min（Nova-2 Pay-as-you-go） | $0.006/min |
| レスポンス速度 | ◎ ストリーミング対応 | ○ バッチのみ |
| ローカル移行 | 不可（クラウドのみ） | ○ Whisper.cppでローカル化可 |
| SDK | Node.js SDK公式あり | OpenAI SDK経由 |

**結論**: Phase 1はDeepgramをメインに。Whisperは代替＆Phase 3ローカル化への布石として切替対応しておく。

---

## 3. 機能仕様

### 3.1 音声入力

#### 3.1.1 ブラウザ内録音（メイン）
- PWA上にワンクリック録音ボタンを設置
- `navigator.mediaDevices.getDisplayMedia()` でシステム音声（会議音声）をキャプチャ
- `navigator.mediaDevices.getUserMedia()` でマイク音声を同時キャプチャ
- 両音声をミックスして録音、または別トラックとして保存
- 録音中はUI上にタイマー表示＋波形ビジュアライザー
- 録音フォーマット：WebM (Opus) → サーバー側でmp3/wav変換（API要件に合わせる）
- 録音開始時に Chrome が画面共有ダイアログを表示する（ブラウザ仕様上回避不可）→ Phase 2 Electron化で解消

#### 3.1.2 ファイルインポート
- 音声ファイルのドラッグ&ドロップまたはファイル選択でアップロード
- 対応形式：mp3, wav, m4a, webm, ogg, flac
- NotePin等の外部デバイスからの音声もこの経路で取り込む
- アップロード後、自動的にパイプライン（文字起こし→要約）を開始

#### 3.1.3 録音設定
- 入力デバイス選択（マイク）
- 録音品質設定（標準 / 高品質）
- 自動停止タイマー（任意設定、長時間会議対策）

### 3.2 文字起こし

#### 3.2.1 基本機能
- 音声アップロード完了後、選択中のエンジン（Deepgram or Whisper）でAPI送信
- 言語：自動検出（デフォルト）or 手動指定
- 話者分離：ON/OFF切替（Deepgram使用時のみ）
- 進捗表示：処理中ステータス → 完了通知

#### 3.2.2 出力フォーマット
```json
{
  "id": "rec_20260330_143000",
  "duration_sec": 3600,
  "language": "ja",
  "engine": "deepgram",
  "speakers": [
    { "id": "speaker_0", "label": "Bami" },
    { "id": "speaker_1", "label": "クライアントA" }
  ],
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "speaker": "speaker_0",
      "text": "今日は新しいプロジェクトについて話しましょう"
    }
  ]
}
```

#### 3.2.3 話者ラベル編集
- 文字起こし結果表示後、Speaker 0/1/2... を具体名に手動変更可能
- 変更したラベルはDB保存され、次回以降のデフォルト候補として表示

#### 3.2.4 文字起こしテキスト手動編集
- 誤認識箇所をインラインで編集可能
- 編集履歴は保持しない（最新のみ）

### 3.3 要約生成

#### 3.3.1 テンプレートシステム
- 要約はプロンプトテンプレートで制御
- テンプレート＝「システムプロンプト + 出力フォーマット指示」のセット
- プリセットテンプレートを数種類用意：
  - 議事録（参加者・議題・決定事項・アクションアイテム）
  - 1on1メモ（話題・フィードバック・ネクストステップ）
  - ブレスト要約（アイデア一覧・評価・優先順位）
  - フリーフォーマット（自由記述の要約）
- カスタムテンプレート：ユーザーが自由にプロンプトを書いて保存
- テンプレート編集UI：プロンプト入力欄 + プレビュー（過去の文字起こしでテスト実行可能）

#### 3.3.2 LLM切替
- 設定画面から使用LLMを選択：
  - Gemini API（モデル選択：Flash / Pro）
  - Grok API
  - OpenAI API（モデル選択：gpt-4o / gpt-4o-mini 等）
- 各LLMのAPIキーは `.env` ファイルから読み込み（Phase 2ではElectronの設定UIから入力）
- テンプレートごとに使用LLMを指定することも可能（任意）

#### 3.3.3 要約生成フロー
1. 文字起こし完了後、デフォルトテンプレートで自動生成
2. 結果に不満なら、別テンプレート or 別LLMを選んで再生成
3. 1つの録音に対して複数の要約を保持可能（テンプレート×LLMの組み合わせ）

#### 3.3.4 要約結果の表示
- Markdown形式で表示（見出し・箇条書き・太字対応）
- コピー（クリップボード）ボタン
- エクスポート：Markdown / プレーンテキスト

### 3.4 タグシステム（Plaudにない独自機能）

#### 3.4.1 自動タグ付け
- 要約生成時に、LLMに「この会話に適切なタグを3〜5個提案して」と同時に依頼
- 提案タグをユーザーが確認 → 採用/却下/編集
- 既存タグとの名寄せ（類似タグの候補表示）

#### 3.4.2 手動タグ付け
- 録音詳細画面からタグを追加・削除
- フリーテキスト入力 + 既存タグからの候補サジェスト
- タグにカラー設定可能（任意）

#### 3.4.3 タグベース検索
- 録音一覧画面でタグフィルタ
- 複数タグのAND/OR検索
- タグ＋キーワード（文字起こし全文検索）の組み合わせ

### 3.5 自動パイプライン（AutoFlow相当）

#### 3.5.1 基本動作
- 録音完了 or ファイルアップロード → 自動で以下を順次実行：
  1. 音声ファイル保存
  2. 文字起こしAPI呼び出し
  3. 要約生成（デフォルトテンプレート + デフォルトLLM）
  4. 自動タグ提案
- 各ステップの完了をリアルタイムでUI反映（ステータスバッジ）

#### 3.5.2 通知
- Phase 1では画面上のトースト通知のみ
- （将来）Discord Webhook or メール通知

### 3.6 録音一覧・管理

#### 3.6.1 一覧画面
- 日付降順で録音を表示
- 各カードに：タイトル（自動生成 or 手動編集）、日時、長さ、タグ、処理ステータス
- タグフィルタ、キーワード検索、日付範囲フィルタ

#### 3.6.2 詳細画面
- 音声プレーヤー（再生位置と文字起こしテキストの連動）
- 文字起こしテキスト（話者ラベル付き、タイムスタンプクリックで再生位置ジャンプ）
- 要約タブ（複数要約がある場合はタブ切替）
- タグ編集エリア
- メタデータ（録音日時、長さ、使用エンジン、使用LLM）

#### 3.6.3 削除
- 録音の削除（音声ファイル + 文字起こし + 要約を一括削除）
- 削除確認ダイアログあり
- ゴミ箱機能は不要（即時削除）

### 3.7 設定画面

- APIキー状態確認（Deepgram / OpenAI / Gemini / Grok）— `.env`から読み込み、設定画面では設定済み/未設定の表示のみ
- デフォルト文字起こしエンジン選択
- デフォルト要約LLM選択
- デフォルト要約テンプレート選択
- デフォルト言語設定
- 話者分離ON/OFFデフォルト
- データ保存先パス（NAS上のディレクトリ）

---

## 4. データモデル（SQLite）

### 4.1 テーブル設計

```sql
-- 録音
CREATE TABLE recordings (
  id TEXT PRIMARY KEY,          -- rec_YYYYMMdd_HHmmss
  title TEXT,                   -- 自動生成 or 手動編集
  file_path TEXT NOT NULL,      -- 音声ファイルのパス
  duration_sec INTEGER,
  recorded_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'uploaded' -- uploaded / transcribing / transcribed / summarizing / completed / error
);

-- 文字起こし
CREATE TABLE transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,          -- deepgram / whisper
  language TEXT,
  segments_json TEXT NOT NULL,   -- JSON: [{start, end, speaker, text}]
  speakers_json TEXT,            -- JSON: [{id, label}]
  raw_response_json TEXT,        -- APIレスポンス全文（デバッグ用）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 要約
CREATE TABLE summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id),
  llm_provider TEXT NOT NULL,    -- gemini / grok / openai
  llm_model TEXT NOT NULL,       -- gemini-2.0-flash, gpt-4o, etc.
  content TEXT NOT NULL,         -- Markdown要約テキスト
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- テンプレート
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  output_format TEXT,            -- 出力フォーマット指示
  is_default BOOLEAN DEFAULT 0,
  preferred_llm_provider TEXT,   -- テンプレ固有のLLM指定（NULL=グローバル設定に従う）
  preferred_llm_model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- タグ
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6B7280'
);

-- 録音×タグ（多対多）
CREATE TABLE recording_tags (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'manual',  -- manual / auto
  PRIMARY KEY (recording_id, tag_id)
);

-- 話者マスタ（学習用）
CREATE TABLE known_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 設定
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL             -- JSON文字列で格納
);
```

---

## 5. API設計（バックエンド）

### 5.1 エンドポイント一覧

```
# 録音
POST   /api/recordings/upload       音声ファイルアップロード（→パイプライン自動開始）
GET    /api/recordings               一覧取得（フィルタ・ページネーション対応）
GET    /api/recordings/:id           詳細取得（文字起こし・要約含む）
PATCH  /api/recordings/:id           タイトル編集
DELETE /api/recordings/:id           削除

# 文字起こし
POST   /api/recordings/:id/transcribe   手動で文字起こし再実行
PATCH  /api/transcriptions/:id          テキスト・話者ラベル編集

# 要約
POST   /api/recordings/:id/summarize    要約生成（テンプレートID・LLM指定）
DELETE /api/summaries/:id               要約削除

# テンプレート
GET    /api/templates                一覧
POST   /api/templates                作成
PATCH  /api/templates/:id            編集
DELETE /api/templates/:id            削除
POST   /api/templates/:id/test       テスト実行（既存文字起こしIDを指定して要約プレビュー）

# タグ
GET    /api/tags                     一覧
POST   /api/recordings/:id/tags      タグ追加
DELETE /api/recordings/:id/tags/:tagId  タグ削除

# 設定
GET    /api/settings                 全設定取得
PATCH  /api/settings                 設定更新

# 音声配信
GET    /api/recordings/:id/audio     音声ファイルストリーミング（プレーヤー用）

# ブラウザ録音
POST   /api/recordings/stream-upload  録音中のチャンクアップロード（WebSocket or chunked POST）
```

---

## 6. UI構成

### 6.1 画面一覧

| 画面 | パス | 概要 |
|------|------|------|
| ダッシュボード | `/` | 録音一覧 + ワンクリック録音ボタン + 検索・フィルタ |
| 録音詳細 | `/recordings/:id` | プレーヤー + 文字起こし + 要約 + タグ |
| テンプレート管理 | `/templates` | テンプレートCRUD + テスト実行 |
| 設定 | `/settings` | APIキー・デフォルト設定 |

### 6.2 デザイン方針
- **ダークモード**固定（ライトモード不要）
- レスポンシブ対応（PC優先、タブレット可、スマホは最低限）
- UIフレームワーク：Tailwind CSS
- 配色：ダークグレー系ベース + アクセントカラー（後で調整）
- Plaud UIの「録音リスト→詳細」の遷移感を参考に

### 6.3 主要UIコンポーネント

#### 録音ボタン（常時表示）
- 画面右下にフローティング表示
- 停止中：●（赤丸）ワンクリックで録音開始
- 録音中：■（停止）+ 経過時間 + 波形アニメーション
- 録音停止 → 自動でアップロード＆パイプライン開始

#### 録音一覧カード
- タイトル / 日時 / 長さ / タグバッジ / ステータスバッジ
- ステータス：アップロード中 → 文字起こし中 → 要約中 → 完了 / エラー

#### 詳細画面レイアウト
- 左ペイン：音声プレーヤー + 文字起こしテキスト（スクロール連動）
- 右ペイン：要約（タブ切替）+ タグ編集

---

## 7. ディレクトリ構成

```
voicescope/
├── docker-compose.yml
├── Dockerfile
├── CLAUDE.md                    # Claude Code用指示書
├── REQUIREMENTS.md              # 本書
├── STATUS.md                    # 進捗管理（Claude Code自動更新）
├── package.json
├── .env.example                 # APIキー設定テンプレート（友人配布用にも）
├── .env                         # 実際のAPIキー（.gitignore対象）
├── server/
│   ├── index.js                 # Expressエントリーポイント
│   ├── routes/
│   │   ├── recordings.js
│   │   ├── templates.js
│   │   ├── tags.js
│   │   └── settings.js
│   ├── services/
│   │   ├── transcription/
│   │   │   ├── index.js         # エンジン切替ディスパッチャ
│   │   │   ├── deepgram.js
│   │   │   └── whisper.js
│   │   ├── summary/
│   │   │   ├── index.js         # LLM切替ディスパッチャ
│   │   │   ├── gemini.js
│   │   │   ├── grok.js
│   │   │   └── openai.js
│   │   ├── pipeline.js          # 自動パイプライン（録音→文字起こし→要約→タグ）
│   │   └── tagging.js           # 自動タグ生成
│   ├── db/
│   │   ├── schema.sql
│   │   └── database.js          # better-sqlite3ラッパー
│   └── utils/
│       └── audio.js             # ffmpegによるフォーマット変換
├── client/
│   ├── index.html
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── RecordingDetail.jsx
│   │   │   ├── Templates.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   │   ├── RecordButton.jsx
│   │   │   ├── AudioPlayer.jsx
│   │   │   ├── TranscriptView.jsx
│   │   │   ├── SummaryView.jsx
│   │   │   ├── TagEditor.jsx
│   │   │   └── StatusBadge.jsx
│   │   ├── hooks/
│   │   │   ├── useRecorder.js   # ブラウザ録音ロジック
│   │   │   └── useAudioPlayer.js
│   │   └── stores/
│   │       └── appStore.js      # Zustand or Jotai
│   ├── vite.config.js
│   └── tailwind.config.js
└── data/                         # Docker volume マウント先
    ├── voicescope.db             # SQLite
    └── audio/                    # 音声ファイル保存
```

---

## 8. 環境変数（.env）

### 8.1 .env.example

```bash
# === VoiceScope 設定 ===

# サーバー
PORT=5100
DATA_DIR=./data

# 文字起こしAPI（メインで使うもののキーは必須）
DEEPGRAM_API_KEY=
OPENAI_API_KEY=

# 要約LLM（使うもののキーを設定）
GEMINI_API_KEY=
GROK_API_KEY=
# OPENAI_API_KEY は文字起こしと共用
```

### 8.2 設定の使い分け

| 設定項目 | 保存先 | 理由 |
|---------|--------|------|
| APIキー | `.env` | 秘密情報、友人配布時にも各自で設定しやすい |
| デフォルトエンジン・LLM・テンプレート | SQLite `settings`テーブル | UIから変更する運用設定 |
| テンプレート定義 | SQLite `templates`テーブル | CRUD対象のデータ |

---

## 9. Docker構成

```yaml
version: '3.8'
services:
  voicescope:
    build: .
    container_name: voicescope
    ports:
      - "5100:5100"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Dockerfile要件：
- Node.js 20 LTS ベース
- ffmpeg インストール（音声フォーマット変換用）
- クライアントビルド（Vite）→ サーバーから静的配信

---

## 10. 永久不要リスト

以下は設計・実装の対象外：
- テンプレート共有コミュニティ機能
- 録音元ソース分類（通話/対面などのカテゴリ分け）
- マインドマップ生成
- サブスクリプション課金機構
- スマホネイティブアプリ

---

## 11. Phase 2以降（参考）

### Phase 2：Electron化（友人配布開始）
- Phase 1のPWAをElectronのBrowserWindowに載せる
- `desktopCapturer` APIでシステム音声キャプチャ（画面共有ダイアログ不要に）
- 会議アプリのウィンドウ検知（プロセス名監視） → 自動録音開始
- トレイ常駐、グローバルショートカット（録音開始/停止）
- .exe ビルド（electron-builder）
- **友人配布**: .exeを渡す。初回起動時にAPIキー設定画面を表示（.envの代わりにElectronの設定ストアに保存）
- 各自が各自のPC上で完全独立運用（データ共有・中央管理なし）

### Phase 3：完全ローカルモード
- 文字起こし：Whisper.cpp or faster-whisper をNASまたはローカルPCで実行
- 話者分離：pyannote（ローカル実行）
- 要約LLM：Ollama (llama.cpp) でローカルLLM実行
- すべてのデータ・処理がローカル完結 → 機密情報対応
- 設定画面で「クラウドモード / ローカルモード」切替

---

## 12. CLAUDE.md 概要（Claude Code用）

Claude Codeが本プロジェクトで遵守すべきルール：

1. **言語**: コード・コメントは英語、UI表示は日本語
2. **STATUS.md**: 各セッション終了時に進捗を更新
3. **技術スタック変更禁止**: 上記選定から変更する場合は必ず事前承認を取ること
4. **エラーハンドリング**: すべてのAPI呼び出しにtry-catch、ユーザーにはフレンドリーなエラーメッセージ
5. **テスト**: 各サービス（transcription, summary, pipeline）にユニットテスト
6. **環境変数**: APIキーは `.env` ファイルで管理（`dotenv`で読み込み）。`.env.example` にキー名のみ記載してリポジトリに含める
7. **コミット単位**: 機能単位でコミット、1コミットで複数機能を混ぜない
