# VoiceScope Mac版ビルド手順

このドキュメントは **Mac を持っている協力者向け** です。  
ビルド済み DMG を VoiceScope メンテナーに送り返してください。

---

## 必要なもの
- **Mac**（Apple Silicon / Intel どちらでもOK）
- 約 **15分** の作業時間
- ストレージ約 **2GB** の空き
- インターネット接続

**Apple Developer アカウントは不要です。**

---

## ステップ1: ターミナルを開く

`Launchpad` → `その他` → `ターミナル` をダブルクリック。  
（または `Cmd+Space` で「ターミナル」と入力）

黒い画面が出ればOK。以降のコマンドは全部この画面に **1行ずつコピペ＆Enter** してください。

---

## ステップ2: 開発ツールをインストール

### 2-1. Xcode コマンドラインツール

```bash
xcode-select --install
```

ポップアップが出たら「インストール」を押す。完了まで5〜10分。  
すでに入っていれば「すでに最新です」のメッセージが出るのでスキップ。

### 2-2. Homebrew（既に入っていればスキップ）

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

途中でパスワードを聞かれるので Mac のログインパスワードを入力。  
最後に「Next steps:」と出たらその指示通りに 2〜3 行コピペ実行（PATH設定）。

### 2-3. Node.js と Bun

```bash
brew install node bun
```

### 2-4. （オプション）DMG作成ツール

```bash
brew install create-dmg
```

なくてもDMGは作れますが、あった方が見た目がきれい。

---

## ステップ3: VoiceScopeのソースを取得

```bash
cd ~/Desktop
git clone https://github.com/bamipeko/voicescope.git
cd voicescope
```

これでデスクトップに `voicescope` フォルダができて、その中に入った状態になります。

---

## ステップ4: 依存パッケージをインストール

```bash
npm run setup
```

2〜5分かかります。途中で警告メッセージが大量に流れますが **気にしなくてOK**（npm の仕様）。  
最後に「added XXX packages」と出れば成功。

---

## ステップ5: アイコンを生成

```bash
./scripts/make-icns.sh
```

`build/mac/icon.icns` が作成されます。

---

## ステップ6: ビルド実行

```bash
npm run mac:build
```

5〜10分かかります。最後に以下のような表示が出れば成功:

```
[6/6] Done.
  App:  /Users/.../voicescope/dist-mac/VoiceScope.app
  DMG:  /Users/.../voicescope/dist-mac/VoiceScope-0.10.0.dmg
```

---

## ステップ7: DMG を取り出して送る

```bash
open dist-mac
```

Finder が開いて `VoiceScope-0.10.0.dmg` というファイルが見えます。  
これを **AirDrop / Google ドライブ / Slack / メール** などで送ってください。

ファイルサイズは約 **80〜120MB** です。

---

## ステップ8: 動作確認（任意）

送る前に動くか確認したい場合:

```bash
open dist-mac/VoiceScope.app
```

ブラウザが自動で開けば成功。

⚠ 初回起動時に「開発元を確認できません」と出る場合 → **右クリック → 「開く」** を選んで「開く」を確認。
これは送り先のユーザーも初回1回だけ通る画面です。

---

## トラブルシューティング

### 「bun: command not found」
→ `brew install bun` を実行。それでも出る場合は新しいターミナルウィンドウを開き直す。

### 「permission denied: ./scripts/make-icns.sh」
→ 以下を実行:
```bash
chmod +x scripts/*.sh build/mac/launcher
```

### 「lipo: command not found」
→ Xcode コマンドラインツールが入っていません。ステップ2-1を実行。

### ビルド途中でエラー終了
→ エラーメッセージの **最後の30行をコピーして** メンテナーに送ってください。

---

## 次回以降の更新ビルド

ソースが更新されたら:

```bash
cd ~/Desktop/voicescope
git pull
npm run setup    # 依存関係も更新があれば
npm run mac:build
```

2回目以降は5分くらいで完了します。

---

## ⚡ 自動化（推奨）

毎回ビルドを頼むのが面倒な場合、**GitHub Actions** で自動化されています。
- リポジトリの `Actions` タブを開く
- 「Build Mac DMG」ワークフローから「Run workflow」ボタンを押す
- 約10分後に `Artifacts` から DMG をダウンロード可能

詳細: [`.github/workflows/build-mac.yml`](.github/workflows/build-mac.yml)
