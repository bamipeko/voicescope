# Phase R0 検証結果

- 開始: 2026-07-03 深夜（Bami就寝中の夜間作業）
- 実施: Claude Code（**Bami明示指示による実装例外**。通常はCodex担当）
- ブリーフ: `docs/briefs/phase-R0-brief.md`

## Scope B: whisper.cpp 長尺クラッシュ修理 — 実装完了・受け入れテスト実行中

### 根本原因（確定・当初の推定から訂正）

**メモリ枯渇ではなかった。** `server/services/transcription/whisper-cpp.js` の spawn オプションに
`timeout: 1800000`（30分）がハードコードされており、**アプリ自身が30分で文字起こしプロセスを強制killしていた**。
CPU の large-v3 は約1〜2倍速でしか処理できないため、約30分を超える録音は必ず途中で死ぬ。
ログの `code null` はこのkillの痕跡（シグナル死）。66分録音が進捗25〜50%で落ちていた事実と完全に一致する。

### 併せて発見した既存バグ

`--output-json` の出力先が入力ファイル名から導出されるため、webm/mp3等の非WAV入力では
一時WAV側にJSONが書かれるのに、コードは元ファイル名+`.json` を読んでいた（=JSONが読めず
フォールバックへ。さらに `--no-timestamps` 指定によりフォールバックの正規表現も一致せず解析失敗）。
非WAV入力の文字起こしが不安定だった一因。

### 修理内容（whisper-cpp.js のみ、他機能に波及なし）

1. **30分固定タイムアウト除去** → 「無応答10分」のストール検知に置換（長時間処理は正当、無応答だけを異常とみなす）
2. **長尺チャンク分割**: ffmpeg の segment muxer で10分単位の16kHz mono WAVに分割 → 順次処理 →
   実チャンク長でタイムスタンプをオフセット補正して連結。メモリ・失敗影響が録音長と無関係になった
3. **JSON出力パスを `-of` で明示** → 非WAV入力でも確実にJSONパース。フォールバック正規表現も機能するよう `--no-timestamps` を廃止
4. **言語検出のロックイン**: チャンク1で検出した言語を以降のチャンクに固定（一貫性+検出コスト削減）
5. **エラーメッセージに回復手段を明記**（モデル縮小 / クラウド再実行の提案）。チャンク位置も表示
6. ffmpeg が無い環境では従来同様の単一パス実行（wav のみ）にフォールバック

### テスト結果

| テスト | 内容 | 結果 |
|---|---|---|
| スモーク1 | 3分クリップ × tiny × 60秒チャンク × 言語auto | ✅ 5.9秒、3チャンク連結、タイムスタンプ重複なし |
| スモーク2 | 同上 × 言語ja明示 | ✅ 6.4秒、24セグメント、末尾181.03s（実長180.04s と一致） |
| 受け入れ2 | **3.5時間の実録音**（12,583秒）× tiny × 10分チャンク | ✅ **合格**。21チャンク・13分7秒で完走、2,491セグメント・18,714文字、末尾12582.05s（実長一致）。旧実装なら30分×0%で即死していた長さ |
| 追加修正 | チャンク境界で1〜3秒のタイムスタンプ重複が3箇所 → 境界クランプを追加 | ✅ 3.5時間で再検証合格（重複0箇所、セグメント数・文字数は完全一致=内容欠落なし） |
| 受け入れ1 | **失敗していた実録音**（rec_20260624100255、3952秒=66分）× large-v3 × 10分チャンク | ✅ **合格**。7チャンク・54分で完走、926セグメント・14,349文字、末尾3951.31s（実長一致）、重複0。旧実装は30分で必ずkillされていた（このrun自体が54分かかっており、旧実装なら確実に死んでいた長さ） |

**→ Scope B 受け入れ条件クリア（2026-07-03 早朝）。**
残る検収観点は「Electronアプリ経由での再処理1回」（Bamiが失敗していた録音の「再文字起こし」を押すだけ）と、
リリース判断（バージョンバンプ+SW CACHE_NAME更新+update.cmd はコミット整理後）。

補足: 3.5時間×large-v3のCPU実行は5時間超かかる見込みのため夜間には未実施（チャンク方式の長さ非依存性は
66分×large-v3 と 3.5h×tiny×21チャンクの組み合わせで実証済み）。CPUでの3時間録音の現実的な運用は
medium以下のモデル推奨。large-v3を常用するならGPU版バイナリ（whisper-cublas）の導入が本命（検収時協議）。

発見メモ:
- tiny モデルは日本語の言語自動検出を外すことがある（3分クリップで nn と誤検出）。
  large-v3 では従来から高精度（ログ実績 p=0.996）。アプリの言語設定を `ja` 固定にしていれば無関係
- whisper.cpp のCPU版バイナリは GPU を一切使わない（`no GPU found`）。公式リリースには
  `whisper-cublas-12.4.0-bin-x64.zip`（CUDA版）が存在するため、RTX 5070 Ti を使えば
  large-v3 でも数分〜十数分で66分録音を処理できる見込み。**採用判断は検収時に協議**
  （配布サイズ・CUDA DLL同梱の要否を要評価。Bami個人利用なら導入価値が高い）

## Scope A: Worker デプロイ — **完了（2026-07-03 朝）**

**本番URL: `https://voicescope.voicescope.workers.dev`**（workers.dev サブドメイン `voicescope` を新規登録）

経緯と発見:
- wranglerログイン失効 → `worker\deploy.ps1` を作成（Bami実行、ブラウザAllow 1クリック）
- スクリプトのPS5.1互換バグ1件（stderr取り込みが致命エラー化）を修正
- **旧記録の「アカウントtka1478 / KV id 889b...」は実在しなかった**（Workerが未デプロイだった5月時点の机上値）。
  実アカウントは tka8963@gmail.com のもの。KVネームスペース `CODES` を新規作成（id: `5254f3b791f64a91840d254d3f7b059a`）
- アプリ内の参照URLを旧値から新URLへ更新: `server/services/managed.js` / `server/config/tiers.js` / `client/src/lib/platform.js`

スモークテスト結果（全通過）:
- `/health` → 200 `{"status":"ok","version":"1.1.0"}`
- `/verify` + VSTEST2026 → JWT発行成功（tier=trial、14日）。deviceHashのhex形式バリデーションも正常動作を確認
- `/v1/chat/completions`（gpt-5-nano）→ JWT認証でOpenAIから実応答

残課題:
- **`.env` の DEEPGRAM_API_KEY / GEMINI_API_KEY が空だった** → おまかせプランのDeepgram文字起こし（本命経路）と
  Gemini要約は、キー記入後に `deploy.ps1` 再実行で有効化。OpenAI系（要約/Whisper文字起こし/画像）とGrokは稼働中
- ANTHROPIC_API_KEY も未設定（Claude要約のみ無効）
- Electron E2E（コード入力→要約1件）は v0.18.1 再ビルド後に実施（インストール済みアプリには旧URLが焼き込まれているため）

## リリース準備: v0.18.1

- package.json `0.18.0 → 0.18.1`
- sw.js `CACHE_NAME: voicescope-v0.17.1 → voicescope-v0.18.1`（0.18.0時に未更新だったのを是正）
- 内容: whisper.cpp長尺修理 + Worker URL更新
- リリース手順: `update.cmd`（ビルド→サイレント上書きインストール→起動）

## Scope D: iOS 展開の段取り — 調査完了

**結論: Mac 不要で iPhone 11 実機に載せられる。ただし Apple Developer Program（US$99/年）加入がほぼ必須。**

| 方法 | 費用 | できること | 制約 |
|---|---|---|---|
| Expo Go アプリ | ¥0 | UI・前面録音の即時動作確認 | バックグラウンド録音・whisper.rn等のネイティブ機能は不可 |
| 無料 Apple ID + Xcode | ¥0 | 実機インストール | **Mac必須**（非所有）+ 7日で証明書失効 → 実質不可 |
| **EAS Build + Ad Hoc 配布（推奨）** | $99/年 | クラウドでiOSビルド→リンクからiPhoneに直接インストール | Apple Developer加入必須。`eas device:create` でiPhone 11のUDID登録 |
| TestFlight | $99/年（同上） | 友人ベータ配布（最大1万人、メール/リンク招待） | 同上。R2の友人配布はこれが本命 |

- iPhone 11（A13）は現行 iOS 対応圏内。whisper.rn の Core ML 実行も A13 で動作圏
- **推奨タイミング**: R0（Android PoC）はお金不要で進む。**R1着工時に Apple Developer 加入**（Android/iOS同時にMVPを作るため）
- Android 側も将来サイドロード規制が段階的に強まる流れがあるため、R2以降で Play クローズドテスト配布を検討

## Scope C: Expo 録音 PoC — 雛形作成完了・バンドル検証済み（実機検証は日中）

最小PoCアプリを作成（録音開始/停止・端末内m4a保存・SQLite記録・一覧表示・長押し削除）。
`npx expo export --platform android` でバンドル成功を確認済み（コンパイルエラーなし）。

**場所のルール（重要）**: 実行本体は **ローカルディスク `C:\projects\voicescape-poc\expo-recorder`**。
NAS（Z:）上での npm install はSMBロックで壊れることを今夜実証済みのため禁止。
リポジトリ `poc/expo-recorder/` にはソースのみ同期してある（node_modules なし）。

明日の手順（Bami作業、約15分）:
1. Pad Air で Expo Go をインストール（Playストア）
2. PC で `cd C:\projects\voicescape-poc\expo-recorder` → `npx expo start`
3. Pad Air の Expo Go で QR を読む → 録音→停止→一覧に残る→アプリ再起動で永続確認
4. バックグラウンド60分テストは dev build（`npx expo run:android`）が必要。手順は `poc/expo-recorder/README-poc.md`

---
（このファイルはテスト完了時に更新される）
