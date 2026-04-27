# VoiceScope リリース・配布手順（あなた専用ガイド）

このドキュメントは VoiceScope のメンテナー（あなた本人）向けです。
新バージョンを作って人に配るまでの全手順をまとめています。

---

## いつもの流れ（Windows・最短ルート）

普段はこの3ステップで終わります:

```powershell
# 1. package.json の "version" を上げる（例: 0.14.1 → 0.14.2）
#    エディタで開いて書き換え。手で。

# 2. コミット & タグ & push
git add package.json
git commit -m "bump v0.14.2"
git tag v0.14.2
git push origin master --tags

# 3. ブラウザで完了確認 → URL を友人に送る
start https://github.com/bamipeko/voicescope/actions
```

GitHub Actions が約10分で Win 2種 + Mac DMG を全部ビルドして Release ページに自動添付してくれます。
Macマシン不要、署名作業不要、友人への手作業送信も不要。

---

## ステップ詳細

### Step 1: バージョン番号を上げる

`package.json` を開いて `"version": "0.14.x"` を書き換えるだけ。

判断基準:
- バグ修正だけ → パッチ番号上げ（`0.14.1` → `0.14.2`）
- 新機能・大きな変更 → マイナー番号上げ（`0.14.x` → `0.15.0`）
- 将来 `1.0.0` 出すときは「正式版」のタイミングで

### Step 2: タグ付き push

PowerShell かコマンドプロンプトで:

```powershell
cd Z:\projects\voicescape

# 一応事前確認
git status
git diff package.json

# コミット → タグ → 一気に push
git add package.json
git commit -m "bump v0.14.2"
git tag v0.14.2
git push origin master --tags
```

`--tags` を付けるのが要点。これがないと Actions のリリースワークフローが発動しません。

#### コミット忘れ修正したい場合

```powershell
# タグだけ作り直し
git tag -d v0.14.2
git push origin :refs/tags/v0.14.2     # remote のタグも削除
# 修正コミットを追加してから再度
git tag v0.14.2
git push origin master --tags
```

### Step 3: GitHub Actions のビルド完了を待つ

push の直後、ブラウザで:

```
https://github.com/bamipeko/voicescope/actions
```

を開く。3つのワークフローが走っているのが見えるはず:

- **Build Mac DMG** (~10分)
- **Build Windows** → 2 jobs:
  - Build Electron Setup.exe (~5分)
  - Build single-exe portable (~7分)

すべて緑チェック ✓ になればOK。
赤い ❌ が出たらクリックして失敗ステップを開く（[トラブルシューティング](#トラブルシューティング) 参照）。

### Step 4: Release ページに添付されているか確認

```
https://github.com/bamipeko/voicescope/releases/latest
```

これが付いていれば成功:

- `VoiceScope-Setup-0.14.2.exe` (Windows Electron)
- `VoiceScope-0.14.2.exe` (Windows シングルEXE)
- `VoiceScope-0.14.2.dmg` (Mac Universal)

### Step 5: 友人に送る

そのまま Release URL を送るだけ。INSTALL.md のリンクも添えると親切です:

```text
VoiceScope v0.14.2 できました。

📥 ダウンロード:
https://github.com/bamipeko/voicescope/releases/latest

📖 はじめての使い方:
https://github.com/bamipeko/voicescope/blob/main/INSTALL.md

Windows なら "VoiceScope-0.14.2.exe"（軽量版）
Mac なら "VoiceScope-0.14.2.dmg"
```

---

## ローカルでも単体ビルドできる（任意）

Windows ローカルで動作確認したい場合:

```powershell
# Electron 版の .exe を作る
npm run electron:build
# → dist-electron/VoiceScope-Setup-0.14.2.exe

# 単一EXE 版を作る（要 bun + NSIS）
npm run win:portable
# → dist-win/VoiceScope-0.14.2.exe
```

ただし **Mac DMG はローカルで作れない**（macOS マシンが必要）ので、結局 GitHub Actions に頼ることになります。
ローカルビルドは「テスト目的」と割り切って、配布は GitHub Actions 経由でやるのが楽。

### Standalone モードを動作確認だけしたい

ビルドせずに今のソースで standalone モードを試せます:

```powershell
npm run standalone:start
```

ブラウザが自動で `localhost:5100` を開きます。データは `%APPDATA%\VoiceScope\` に保存されるので、
普段の Electron 版と同じデータが見えます。

---

## 配り方は3パターン

通常は **A** だけで足ります。

| 方法 | 向いている場面 | 必要なもの |
|---|---|---|
| **A. GitHub Releases** ⭐ 推奨 | 友人複数人 / 継続配布 / Mac版が必要 | git + ブラウザ |
| **B. ファイル直送** | 1人だけ / 1回限り | DM・ファイル便など |
| **C. プライベート配布サーバ** | 大勢に / 認証付き | 自前のサーバ |

### B. ファイル直送（1人だけに渡す）

A をまずやって Release ページに上げてから、そこからDL→転送するのが確実。

サイズ目安:
| ファイル | サイズ | 使えるサービス |
|---|---|---|
| 単一EXE Windows | 55 MB | LINE / Slack / 大半のメール |
| Mac DMG | 100 MB | Slack / Googleドライブ / WeTransfer |
| Electron Setup.exe | 180 MB | Googleドライブ / WeTransfer |

LINE は 1GBまで、メール添付は 25MBが多いので、Setup.exe を直送するなら **Googleドライブ** が楽。

### C. プライベート配布サーバ

NAS や個人サーバに `.exe` / `.dmg` を置く方式。Basic 認証でアクセス制御可能。
特別な事情がなければ A で十分。

---

## トラブルシューティング

### `git push --tags` で「タグが既にある」エラー

```powershell
# remote のタグを消してやり直し
git tag -d v0.14.2
git push origin :refs/tags/v0.14.2
git tag v0.14.2
git push origin --tags
```

### GitHub Actions のビルドが失敗

1. `https://github.com/bamipeko/voicescope/actions` を開く
2. 失敗したワークフローをクリック
3. 赤い ❌ がついた step をクリック → ログ確認

よくある原因:
- **依存関係 breaking change** — `npm install` 失敗。ローカルで `npm run setup` を試して成功確認してから push し直す
- **Bun が新バージョンを引いた影響** — workflow の `bun-version: latest` を固定バージョンに変えるか、ソース側を修正
- **NSIS の構文エラー** — `installer.nsi` を編集した直後によくある。ローカルで `npm run win:portable` を走らせて事前確認

### Release ページにファイルが添付されていない

- タグを `v0.14.2` のように **`v` プレフィックス必須**。`0.14.2` だけだと workflow が発動しない
- ワークフローが完走していない可能性 → Actions タブで確認
- workflow_dispatch で手動再実行可能

### 友人が「開発元を確認できません」で開けない

これは正常。INSTALL.md に書いてある通り:
- Windows: SmartScreen の警告 → 「詳細情報」→「実行」
- Mac: 右クリック → 「開く」

→ 解消したい場合は Apple Developer Program (¥13,000/年) または Microsoft 署名証明書（年¥30,000〜）の購入が必要

---

## 配布チェックリスト

リリース前に確認:

- [ ] 動作確認した（少なくとも `npm run dev` または `npm run electron:dev` でローカル起動・録音テスト）
- [ ] `package.json` の `version` を上げた
- [ ] `.env` を `.gitignore` で除外したまま（コミットに混入していない）
- [ ] `git tag v0.14.x` で `v` プレフィックス付き
- [ ] `git push origin master --tags` 完了
- [ ] GitHub Actions が3ジョブとも緑 ✓
- [ ] Release ページに3ファイル全部添付
- [ ] 友人に Release URL + INSTALL.md URL を送った

---

## 別案: iPad / ブラウザだけでリリース

PC が手元にないときの代替手順。Safariだけで完結します。

1. Safari で `https://github.com/bamipeko/voicescope` を開く
2. URL を `github.com` → `github.dev` に書き換えて Enter
3. VS Code 風の画面で `package.json` を編集
4. 左の Source Control から commit & push
5. `https://github.com/bamipeko/voicescope/releases/new` を開いてタグ作成
6. 「Publish release」で Actions が動く

iPad 専用の詳細は [BUILD_FROM_IPAD.md](./BUILD_FROM_IPAD.md) を参照。

---

## まとめ

```
新バージョン作って配る (Windows)
        ↓
  package.json の version を上げる
        ↓
  git commit + git tag v0.14.x
        ↓
  git push origin master --tags
        ↓
  GitHub Actions が10分で全OS分ビルド
        ↓
  Release ページに自動添付
        ↓
  URLを友人に送る → 完了
```

普段の作業は5分以内に終わります。
```
