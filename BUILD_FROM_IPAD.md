# iPad だけで Mac版 / Windows版 をリリースする手順

GitHub Actions が自動でビルドしてくれるので、**Mac本体も友人も不要**です。
iPadのSafariからボタンをポチポチするだけで完結します。

---

## 仕組み

リポジトリにコミット or 手動トリガーすると、GitHubが用意したマシンで:
- **Mac版**: macOSランナーが `dist-mac/VoiceScope-x.y.z.dmg` を生成
- **Windows版**: Windowsランナーが `dist-electron/VoiceScope-Setup-x.y.z.exe` を生成

完成したファイルは GitHub の `Actions` タブからダウンロード可能。
バージョンタグ（`v0.10.0`など）で push すれば、`Releases` ページに自動で添付されます。

---

## 方法A: 手動ビルド（一番手軽）

### iPad で操作

1. Safari で `https://github.com/bamipeko/voicescope/actions` を開く
2. 左メニューから **「Build Mac DMG」** または **「Build Windows EXE」** を選択
3. 右上の **「Run workflow」** ボタンをタップ
4. ブランチを選んで（通常は `main`）「Run workflow」緑ボタンを押す
5. 約 **5〜10分** 待つ（画面を閉じてもOK）
6. ビルド完了したら、そのRunの詳細ページの一番下に **「Artifacts」** セクションが現れる
7. `VoiceScope-0.10.0-mac` をタップ → ZIP ファイルがダウンロードされる
8. ZIPを解凍するとDMGファイルが入っている

DMGをユーザーに配布。

---

## 方法B: コードを編集 → 自動ビルド

iPadでもコード編集は可能です。

### 必要なアプリ
- **Working Copy**（有料 約2,500円）— iPad用Gitクライアント
  - 無料版もあるが書き込み制限あり
- **GitHub のWebエディタ**（無料）— github.dev で十分

### Web エディタの使い方（無料）

1. Safariで `https://github.com/bamipeko/voicescope` を開く
2. URL の `github.com` を **`github.dev`** に書き換えて Enter
3. VS Code のような画面が開く（iPadでも操作可能）
4. ファイルを編集 → 左メニューの「Source Control」アイコン → コミットメッセージ入力 → ✓ボタン
5. push すると自動的にビルドが走る
6. 数分後 `Actions` タブで完了を確認 → 上記方法Aと同じ手順でDMGを取得

---

## 方法C: 正式リリース（バージョン上げ）

`v0.10.1` のように新しいバージョンタグを付けると、GitHub Releases ページに DMG/EXE が自動添付されてユーザーが直接ダウンロードできます。

### iPad での操作

1. github.dev でリポジトリを開く
2. `package.json` の `"version"` を新しい数値に書き換える（例: `0.10.0` → `0.10.1`）
3. コミット & push
4. Safariで `https://github.com/bamipeko/voicescope/releases/new` を開く
5. **「Choose a tag」** で `v0.10.1` と入力 → 「Create new tag」を選択
6. リリースタイトルと説明を書く（任意）
7. **「Publish release」** ボタンをタップ
8. これで GitHub Actions が走り、約10分後に DMG/EXE がそのリリースページに自動添付される
9. ユーザーは `https://github.com/bamipeko/voicescope/releases/latest` から最新版をDLできる

---

## トラブル時

ビルドが失敗した場合:

1. `Actions` タブで失敗したRunを開く
2. 赤い ❌ が付いたステップをタップ → エラーログが表示される
3. ログをコピーして相談

---

## コスト

- GitHub Actions の無料枠: **月 2,000分**（macOSは10倍消費なので実質200分=20回くらいビルド可）
- 個人の趣味プロジェクトなら **完全無料** で運用可能
- 超過しそうなら、リリース時のみワークフローを回す運用に変える

---

## まとめ

| やりたいこと | 必要なもの |
|---|---|
| 既存ソースのまま再ビルド | iPadのSafariだけ（方法A） |
| ちょっとした修正してビルド | iPadのSafari + github.dev（方法B、無料） |
| 本格的にコード書く | Working Copy アプリ（方法B、有料） |
| 正式版リリース | iPadのSafariだけ（方法C） |

**Mac本体も友人も完全に不要です。**
