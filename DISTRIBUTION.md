# VoiceScope 配布物ガイド（技術詳細）

> **このドキュメントは技術詳細です。**
> - 受け取った人向けの使い方 → [INSTALL.md](./INSTALL.md)
> - 配布する側の手順 → [RELEASE.md](./RELEASE.md)

VoiceScope は複数の配布形態で提供しています。用途に応じてお選びください。

## 配布物一覧

| 配布物 | OS | サイズ | 用途 |
|---|---|---|---|
| [**VoiceScope-Setup-x.y.z.exe**](#a-windows-electron-setup) | Windows | ~180MB | 常駐型・トレイ・ショートカット派 |
| [**VoiceScope-x.y.z.exe**](#b-windows-単一exe-portable-推奨) | Windows | ~55MB | 軽快・手軽さ重視 ⭐ 推奨 |
| [**VoiceScope-x.y.z.dmg**](#c-macos-app) | macOS | ~100MB | Mac用（Universal binary） |
| [Docker image](#d-docker) | Linux/Win/Mac | 変動 | セルフホスト・開発者向け |

---

## A) Windows Electron Setup.exe

**ファイル名**: `VoiceScope-Setup-0.13.0.exe`

### 特徴
- 従来のインストーラ形式（NSIS）
- スタートメニューに登録、Program Files に配置
- システムトレイに常駐（ウィンドウを閉じてもバックグラウンドで動作）
- グローバルショートカット（`Ctrl+Shift+F8`で録音開始/停止）
- Meet自動検知（Google Meet が開くと録音候補を提示）
- Discord Rich Presence 対応

### 使い方
1. DL → ダブルクリック
2. インストール先選択 → インストール
3. スタートメニュー または デスクトップショートカットから起動

### 向いているユーザー
- デスクトップアプリとして使いたい
- トレイ常駐でいつでも録音したい
- 会議ソフト連携を使いたい

---

## B) Windows 単一EXE portable ⭐ 推奨

**ファイル名**: `VoiceScope-0.13.0.exe`

### 特徴
- **たった1ファイル** を配布するだけ
- インストーラなし、ダブルクリックで即起動
- **ブラウザで開く**（普段使いのブラウザのタブで動作）
- メモリ使用量が Electron 版の1/3程度（~150MB）
- USBメモリに入れて持ち歩き可能
- アンインストールはファイル削除だけでOK

### 動作の仕組み
```
VoiceScope.exe ダブルクリック
    ↓
%LOCALAPPDATA%\VoiceScope-app\ に自動展開（2-3秒）
    ↓
サーバーがバックグラウンドで起動
    ↓
デフォルトブラウザで http://localhost:5100 が自動で開く
```

- データ保存先: `%APPDATA%\VoiceScope\`（録音・DB・APIキー）
- プログラム展開先: `%LOCALAPPDATA%\VoiceScope-app\`（バージョン更新時に上書き）
- 二重起動は自動検知 → 既存のタブを開くだけで安全

### 向いているユーザー
- 軽くサクッと使いたい
- ブラウザで完結したい
- 複数PCで持ち運んで使いたい
- Electron の180MBに抵抗がある

### 制限
- トレイ常駐・グローバルショートカット・Meet自動検知は未対応（Electron版の特典）

---

## C) macOS .app

**ファイル名**: `VoiceScope-0.13.0.dmg`

### 特徴
- Universal binary（Apple Silicon / Intel 両対応）
- `.app` ダブルクリックでサーバー起動 → 既定ブラウザで開く
- 単一EXE版と同じく「ブラウザGUI」方式

### 使い方
1. DMG をダウンロード
2. `VoiceScope.app` を `Applications` にドラッグ
3. 初回起動時: **右クリック → 「開く」**（Gatekeeper警告回避）
4. 2回目以降は普通にダブルクリック

### データ保存先
- `~/Library/Application Support/VoiceScope/` — 録音・DB・APIキー
- `~/Library/Logs/VoiceScope/server.log` — ログ

---

## D) Docker

開発者・セルフホスト用途向け。

```bash
docker run -d \
  -p 5100:5100 \
  -v voicescope-data:/data \
  --env-file .env \
  ghcr.io/bamipeko/voicescope:latest
```

ブラウザで http://localhost:5100 を開く。

---

## どれを選べばいい？

| 使い方 | オススメ |
|---|---|
| 初めて使う | **単一EXE (B)** ⭐ |
| Windowsで普段使い | **単一EXE (B)** |
| 会議ソフト連携したい | **Setup.exe (A)** |
| トレイ常駐で使いたい | **Setup.exe (A)** |
| Mac | **DMG (C)** |
| サーバーに立てたい | **Docker (D)** |

---

## 共通情報

### 必要なAPIキー
どの配布物も、起動後に **設定画面** から以下のAPIキーを登録します:

- **Deepgram** or **OpenAI** — 文字起こし（どちらか一つでOK）
- **xAI (Grok)** — 文字起こし（Grok STT使用時）、要約、AI質問
- **Gemini** / **Anthropic** — 要約、AI質問（オプション）

自前のAPIキーがない場合は、[**トライアルコード**](./README.md#trial) でマネージドモードを使うこともできます。

### 動作要件

| 項目 | 最小 | 推奨 |
|---|---|---|
| OS | Windows 10 / macOS 11+ | Windows 11 / macOS 14+ |
| RAM | 4GB | 8GB+ |
| ストレージ | 500MB | 2GB+（録音ファイル用） |
| ブラウザ | Chrome 120+ / Edge / Safari 17+ | 最新版 |
| ネットワーク | 不要（ローカルLLM使用時） | 安定したインターネット |
