# VoiceScope リリース・配布手順（あなた専用ガイド）

このドキュメントは VoiceScope のメンテナー（あなた本人）向けです。
新バージョンを作って人に配るまでの全手順をまとめています。

---

## 配り方は3パターン

| 方法 | 向いている場面 | 必要なもの |
|---|---|---|
| **A. GitHub Releases** ⭐ 推奨 | 友人複数人 / 継続配布 / Mac版が必要 | iPad/PC のブラウザだけ |
| **B. ファイル直送** | 1人だけ / 1回限り | DM・ファイル便など |
| **C. プライベート配布サーバ** | 大勢に / 認証付き | 自前のサーバ |

ほとんどの場合 **A の GitHub Releases** で完結します。

---

## A. GitHub Releases で配る（推奨フロー）

### 仕組み

1. あなたが新バージョンタグ（例: `v0.14.1`）をGitHub上で作る
2. GitHub Actions が自動でWindows・Macそれぞれのマシンを起動
3. 約10分で Setup.exe / 単一EXE / dmg をビルド完了
4. 自動で Release ページに添付される
5. 友人にURLを送る → 友人がそこから直接DL

**メリット**:
- iPad だけで完結（Macも友人もMacマシンも要らない）
- 配布ファイルは GitHub に永続的に残る
- 月20回くらいまで無料

### iPad で操作する場合（最短ルート）

#### Step 1: バージョンを上げる

1. Safari で `https://github.com/bamipeko/voicescape` を開く
2. URL の `github.com` を **`github.dev`** に書き換えて Enter
3. VS Code 風の画面が開くので、左ペインから `package.json` を開く
4. `"version": "0.14.0"` を新しい数値に書き換える（例: `0.14.1`）
5. 左メニューの「Source Control」アイコン（分岐マーク）→ メッセージ欄に `bump v0.14.1` と入力 → ✓ボタン
6. 「Sync Changes」を押して push

#### Step 2: タグを切ってリリース作成

1. Safari で `https://github.com/bamipeko/voicescape/releases/new` を開く
2. **「Choose a tag」** をタップ → `v0.14.1` と入力 → 「Create new tag: v0.14.1 on publish」を選択
3. **Release title**: `v0.14.1` （タイトルだけでOK）
4. **Description**: 変更点を箇条書き（任意。空でも動く）

   ```markdown
   - 整形と要約を並列化、整形完了が即UIに反映されるように
   - 録音詳細画面に「エクスプローラで開く」ボタン追加
   - アーカイブ／ゴミ箱機能を新設
   ```

5. **「Publish release」** をタップ

#### Step 3: 自動ビルドを待つ

1. `https://github.com/bamipeko/voicescape/actions` を Safari で開く
2. 「Build Mac DMG」と「Build Windows」が走っているのが見える
3. 約 **10分** 待つ（画面を閉じてもOK、続行されます）
4. 両方とも緑チェック ✓ になったら完了

#### Step 4: Release URL を共有

1. `https://github.com/bamipeko/voicescape/releases/latest` を開く
2. 添付ファイル一覧に以下が並んでいれば成功:
   - `VoiceScope-Setup-0.14.1.exe` (Electron Windows)
   - `VoiceScope-0.14.1.exe` (シングルEXE Windows)
   - `VoiceScope-0.14.1.dmg` (Mac)
3. このページのURLを友人に送る → DL指示
4. **既に[`INSTALL.md`](./INSTALL.md)があるので、URLと一緒に説明書のリンクも添えるとよいです**

```text
こんにちは！VoiceScope できました
DLはここから:
https://github.com/bamipeko/voicescape/releases/latest

使い方はこちら（Windows/Mac両対応の説明書）:
https://github.com/bamipeko/voicescape/blob/main/INSTALL.md
```

### PC で操作する場合

ローカルでも同じことができます:

```bash
# 1. バージョンを上げる
# package.json の "version" を編集

# 2. コミット & タグ
git add package.json
git commit -m "bump v0.14.1"
git tag v0.14.1
git push origin main --tags
```

タグpush後の流れは iPad の Step 3〜4 と同じ。

---

## B. ファイル直送（少人数・即配布）

GitHub Actions で生成された `.exe` / `.dmg` をDLして、DMやファイル便で渡す方法。

### 手順

1. 上記 A のフローでまず GitHub Releases に上げる
2. Safari で Release ページを開く → 各ファイルを **長押し → 共有** で iPad内 や iCloud Drive に保存
3. AirDrop / LINE / Slack などで友人に送る

### サイズ制限の目安

| ファイル | サイズ | 使えるサービス |
|---|---|---|
| 単一EXE Windows | 55 MB | LINE / Slack / 大半のメール |
| Mac DMG | 100 MB | Slack / Googleドライブ / WeTransfer |
| Electron Setup.exe | 180 MB | Googleドライブ / WeTransfer / ファイル便 |

LINE は 1GBまで、メール添付は 25MBが多いので、 **Setup.exe を直送するなら Googleドライブが楽**。

---

## C. プライベート配布サーバ（応用）

NAS や個人サーバに置きたい場合:

1. GitHub Release から `.exe` / `.dmg` をDL
2. 自宅NASやレンタルサーバの Web 公開フォルダに配置
3. アクセス制御（Basic認証など）を入れる
4. URLを配布

GitHub Releases で十分なケースが多いので、**特別な事情がなければ A 推奨**。

---

## バージョン番号のルール

[Semantic Versioning](https://semver.org/lang/ja/) を緩く採用:

- **0.x.0** — 機能追加 / 大きな変更（マイナー）
- **0.x.y** — バグ修正 / 小さな改善（パッチ）

例:
- アーカイブ機能追加 → `0.13.x` → `0.14.0`
- そのバグ修正 → `0.14.0` → `0.14.1`
- 課金システム追加 → `0.14.x` → `0.15.0`
- 1.0.0 リリースは「正式版」のタイミングで

---

## トラブルシューティング

### GitHub Actions のビルドが失敗した

1. `https://github.com/bamipeko/voicescape/actions` を開く
2. 失敗したワークフローをタップ
3. 赤い ❌ がついた step を開く
4. ログを確認、エラーメッセージで対応

よくある原因:
- **依存関係の breaking change**: `npm install` 失敗 → ローカルで動作確認してから push
- **電子署名関連**: Mac/Win 両方とも署名なしで配布しているため通常発生しないが、稀に Apple/MS のサーバ側変更で詰まることあり

### リリース URL がうまく開けない

`https://github.com/bamipeko/voicescape/releases` でリリース一覧から探してもらう（タグ名と日付で識別可能）。

### 友人が「開発元を確認できません」で開けない

- Windows: SmartScreen の警告 → 「詳細情報」→「実行」
- Mac: 右クリック → 「開く」（INSTALL.md に書いてある）

→ Apple Developer Program (¥13,000/年) に加入すれば Mac の警告は消えますが、現状は無料配布で十分です

---

## 配布チェックリスト

リリース前にこのリストで確認:

- [ ] バージョン番号を上げた (`package.json`)
- [ ] ローカルで動作確認済み（少なくとも Windows）
- [ ] CHANGELOG / Release notes を書いた（任意）
- [ ] APIキーがコードに混入していないか確認（`.env` を gitignore に入れている）
- [ ] タグを push（v付き）
- [ ] GitHub Actions が両OS分とも緑チェック
- [ ] 配布物 3つ全部が Release ページに添付されている
  - [ ] `VoiceScope-Setup-x.y.z.exe`
  - [ ] `VoiceScope-x.y.z.exe`
  - [ ] `VoiceScope-x.y.z.dmg`
- [ ] 友人に Release URL と INSTALL.md URL を送った

---

## まとめ

```
新バージョン作って配る
        ↓
  package.json のバージョン上げる
        ↓
  v0.14.1 タグを push
        ↓
  GitHub Actions が10分でビルド
        ↓
  Release ページに自動添付
        ↓
  URLを友人に送る → 完了
```

iPadのSafariだけでこれが全部できるのが今の構成の強みです。
