# Mac Build Guide

## 必要なもの
- **macOS**（Appleシリコン or Intel）
- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- **Node.js** 20+ — クライアント(Vite)ビルド用
- **create-dmg**（オプション）— `brew install create-dmg`
- **Xcode Command Line Tools** — `xcode-select --install`

Apple Developer Program は**不要**です。ad-hoc 署名で配布します。

## ビルド手順

```bash
# 1. 依存関係
npm run setup

# 2. アイコン生成（電子の PNG から .icns を作る。初回のみ）
./scripts/make-icns.sh electron/assets/icon.png

# 3. ビルド
npm run mac:build           # Universal (arm64 + x64)
npm run mac:build:arm64     # Apple Silicon専用（小さい）
npm run mac:build:x64       # Intel専用
```

出力は `dist-mac/VoiceScope.app` と `dist-mac/VoiceScope-x.y.z.dmg`。

## 配布されるユーザー体験

1. DMGをダウンロード
2. VoiceScope.app を Applications にドラッグ
3. 初回起動時:
   - Gatekeeper警告「開発元を確認できません」
   - **解決方法**: Finder で右クリック → 「開く」を選択 → 確認ダイアログで「開く」
   - 2回目以降は普通にダブルクリックでOK
4. ブラウザが自動で `http://localhost:5100` を開く
5. Settings画面でAPIキーを設定（OpenAI / Deepgram / Gemini / Grok / Claude）
6. 録音開始

## 初回起動フロー（技術詳細）

- `VoiceScope.app/Contents/MacOS/VoiceScope` (launcher script) が発火
- 環境変数を設定（`VOICESCOPE_STANDALONE=1` etc.）
- `voicescope-server` (Bun-compiled Node binary) をフォアグラウンドで起動
- Port 5100 で Express が待受
- 800ms 後に `open http://localhost:5100` でデフォルトブラウザを開く
- データは `~/Library/Application Support/VoiceScope/` に保存
  - `voicescape.db` — SQLite
  - `audio/` — 録音ファイル
  - `config.json` — APIキー（AES-256-GCM暗号化）
- ログは `~/Library/Logs/VoiceScope/server.log`

## トラブルシューティング

**起動しない** — `Applications/Utilities/Console.app` で VoiceScope を検索、または:
```bash
tail -f ~/Library/Logs/VoiceScope/server.log
```

**ポート競合** — 他のアプリが 5100 を使っている場合は:
```bash
PORT=5200 open "/Applications/VoiceScope.app"
```
※ 現状は PORT 引数取得を launcher に実装していないため、代案として
   ターミナルで `PORT=5200 /Applications/VoiceScope.app/Contents/MacOS/voicescope-server` 直接起動。
   将来的には UI で設定可能にする予定。

**完全アンインストール**
```bash
rm -rf "/Applications/VoiceScope.app"
rm -rf "$HOME/Library/Application Support/VoiceScope"
rm -rf "$HOME/Library/Logs/VoiceScope"
```
