# VoiceScope R0 録音PoC

目的: OPPO Pad Air（Android 13）/ iPhone 11 での「長時間録音 × ローカル保存」の生存性検証。
本実装ではない。UIは検証に必要な最小限のみ。

## 場所のルール

- **実行はローカルディスクのこのフォルダで行う**（`C:\projects\voicescape-poc\expo-recorder`）。
  NAS（`Z:`）上で `npm install` するとSMBロックで壊れるため禁止（リポジトリにはソースのみ同期）
- リポジトリ側コピー: `Z:\projects\voicescape\poc\expo-recorder\`（node_modules なし）

## ステップ1: Expo Go で前面録音テスト（約15分・お金不要）

1. Pad Air に Play ストアから **Expo Go** を入れる
2. PC で:
   ```powershell
   cd C:\projects\voicescape-poc\expo-recorder
   npx expo start
   ```
3. Pad Air の Expo Go でQRコードを読む → アプリが起動
4. 「録音開始」→ 数分録音 → 「停止して保存」→ 一覧に残ることを確認
5. アプリを完全に落として再起動 → 一覧が残っていること（SQLite永続化）

## ステップ2: バックグラウンド/画面オフ 60分テスト（dev build 必要）

Expo Go ではバックグラウンド録音の挙動を正しく検証できないため、dev build を作る:

```powershell
cd C:\projects\voicescape-poc\expo-recorder
npx expo run:android   # USB接続した Pad Air 上に直接ビルド&インストール
```

- 要: Android Studio / SDK / JDK（Sumika プロジェクトでインストール済みの環境を流用）
- Pad Air 側: 設定 → デバイス情報 → ビルド番号7回タップ → USBデバッグON

検証項目（結果は docs/poc-r0-results.md に記録）:
1. 画面オフで60分録音 → 完走するか、m4a が再生できるか
2. 3時間録音を1回 → ファイルサイズ・電池消費をメモ
3. 録音中に他アプリを使う / 通知を受ける → 録音が生きているか
4. 録音がOSに殺される場合 → Foreground Service 常駐が必要という判定になる
   （次の一手: `@siteed/expo-audio-studio` への差し替え、または notifee でFGS追加）

## ステップ3: whisper.rn テスト（dev build 派生）

dev build が動いたら whisper.rn を追加し、5分の日本語クリップで速度/精度を実測:
```powershell
npm install whisper.rn
npx expo run:android
```
tiny / base モデルで計測。Pad Air（Snapdragon 680）は「実用外」の結果でも判定材料として有効。

## 既知の注意

- expo-file-system は SDK 54 から新APIがデフォルト。本PoCは `expo-file-system/legacy` を使用
- Android 13 は通知権限（POST_NOTIFICATIONS）が実行時要求
- iPhone 11 での実行は Expo Go（ステップ1のみ）は無料。dev build は Apple Developer Program（$99/年）が必要
