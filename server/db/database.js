import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabasePath, ensureAppDirs } from '../utils/platform-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data dirs exist before computing DB path
ensureAppDirs();
const DB_PATH = getDatabasePath();

let db = null;

export async function initDatabase() {
  // Locate sql.js WASM binary — precedence:
  //   1. VOICESCOPE_SQLJS_WASM (env) — used by bun-compiled standalone binary
  //   2. import.meta.resolve('sql.js') — normal node_modules resolution
  //   3. asar.unpacked path — Electron
  let wasmUrl;
  if (process.env.VOICESCOPE_SQLJS_WASM && fs.existsSync(process.env.VOICESCOPE_SQLJS_WASM)) {
    wasmUrl = process.env.VOICESCOPE_SQLJS_WASM;
  }
  if (!wasmUrl) {
    try {
      const sqlJsDir = path.dirname(new URL(import.meta.resolve('sql.js')).pathname);
      // On Windows, URL pathname starts with /C: — strip the leading /
      const cleanDir = process.platform === 'win32' ? sqlJsDir.replace(/^\//, '') : sqlJsDir;
      const wasmPath = path.join(cleanDir, 'sql-wasm.wasm');
      if (fs.existsSync(wasmPath)) {
        wasmUrl = wasmPath;
      }
      if (!wasmUrl) {
        const unpackedPath = wasmPath.replace('app.asar', 'app.asar.unpacked');
        if (fs.existsSync(unpackedPath)) wasmUrl = unpackedPath;
      }
    } catch (e) {
      // Fallback: let sql.js find it automatically
    }
  }

  const sqlOptions = wasmUrl ? { locateFile: () => wasmUrl } : {};
  const SQL = await initSqlJs(sqlOptions);

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new SQL.Database();
  }

  // Enable WAL mode and foreign keys
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  // Run schema. Precedence:
  //   1. VOICESCOPE_SCHEMA_SQL (env) — set by bun-compiled standalone
  //   2. __dirname/schema.sql — dev / electron-asar-unpacked
  let schemaPath = process.env.VOICESCOPE_SCHEMA_SQL;
  if (!schemaPath || !fs.existsSync(schemaPath)) {
    schemaPath = path.join(__dirname, 'schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = schemaPath.replace('app.asar', 'app.asar.unpacked');
  }
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.run(schema);

  // Migrations for existing databases
  runMigrations();

  // Seed default templates
  seedTemplates();
  seedNewTemplates();

  // Seed default settings
  seedSettings();

  // Save to disk
  save();

  console.log(`Database initialized at ${DB_PATH}`);
  return db;
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save after modifications
function runAndSave(sql, params = []) {
  db.run(sql, params);
  save();
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// Helper: run INSERT/UPDATE/DELETE and save
export function execute(sql, params = []) {
  runAndSave(sql, params);
}

// Helper: SELECT single row
export function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    result = {};
    columns.forEach((col, i) => { result[col] = values[i]; });
  }
  stmt.free();
  return result;
}

// Helper: SELECT multiple rows
export function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  const columns = stmt.getColumnNames();
  while (stmt.step()) {
    const values = stmt.get();
    const row = {};
    columns.forEach((col, i) => { row[col] = values[i]; });
    results.push(row);
  }
  stmt.free();
  return results;
}

// Helper: get last inserted row id
export function lastInsertRowId() {
  return queryOne('SELECT last_insert_rowid() as id')?.id;
}

// All available templates — used for both fresh DB and migration
const ALL_TEMPLATES = [
  {
    name: '議事録',
    description: '会議の参加者・議題・決定事項・アクションアイテムを構造化',
    is_default: 1,
    system_prompt: `あなたはプロフェッショナルな会議記録の専門家です。以下の文字起こしデータから、正確で実用的な議事録を作成してください。

<rules>
- 文字起こしに明示的に含まれる情報のみ記載する。推測や捏造は絶対にしない
- 決定事項とアクションアイテムは特に正確に。曖昧な場合は「（確認必要）」と注記する
- 「えー」「あの」等のフィラーや重複表現は除去し、意味を保ったまま簡潔な文語体（である調）に整える
- 発言者が判別できる場合は発言を帰属させる
</rules>

<output_format>
## 概要
- **日時**: （文中に言及があれば記載、なければ省略）
- **参加者**: 話者ラベルまたは判別できた名前
- **目的**: 会議の主題を1-2文で

## 議題と議論

### 議題1: （トピック名）
- 論点の要約
- 主な発言と根拠
- 結論または方向性

（議題ごとに繰り返し）

## 決定事項
1. （確定した内容を明確に記載）

## アクションアイテム

| タスク | 担当 | 期限 | 備考 |
|--------|------|------|------|
| 具体的なタスク | 担当者名 | 期限（言及があれば） | 補足 |

## 保留事項
- 結論が出なかった議題や継続検討事項

## 次回に向けて
- フォローアップが必要な事項
</output_format>`,
  },
  {
    name: 'アイデアメモ・ブレスト',
    description: '音声メモやブレストからアイデアを漏れなく拾い上げて整理',
    is_default: 0,
    system_prompt: `あなたはクリエイティブシンキングの整理専門家です。以下の文字起こしデータから、すべてのアイデアを漏れなく抽出・整理してください。

<rules>
- アイデアは未完成・半端なものも含めてすべて拾う。ブレストでは量が重要
- 発言者ごとにアイデアを帰属させる（判別できる場合）
- アイデア同士の関連性や発展の流れを可視化する
- あなた自身の意見やアイデアは追加しない。文字起こしに含まれるものだけを整理する
- 口語的な表現は活かしつつ、要点が伝わるように整える
</rules>

<output_format>
## テーマ・背景
このブレスト/メモの中心テーマを1-2文で

## アイデア一覧

### 1. （アイデア名を端的に）
- **内容**: 具体的な説明
- **発言者**: （判別できれば）
- **成熟度**: 💡着想 / 🔧具体案 / ✅実行可能
- **関連**: （他のアイデアとの関連があれば）

（すべてのアイデアを列挙）

## アイデアマップ
- アイデア同士のつながりや発展関係を箇条書きで

## 気になるキーワード・フレーズ
- 会話中に出た印象的な表現やヒントになりそうな言葉

## ネクストステップ
- 会話の中で言及された次のアクション
</output_format>`,
  },
  {
    name: 'コラム作成',
    description: '会話内容を読み物として成立するコラム記事に再構成',
    is_default: 0,
    system_prompt: `あなたはプロの編集者・コラムニストです。以下の文字起こしデータを、読み応えのあるコラム記事に再構成してください。

<rules>
- 話者の主張・洞察・体験談を核にして、読者に価値を届ける記事を構成する
- 元の発言にない事実や意見は絶対に追加しない
- 話し言葉を自然な書き言葉（です/ます調）に変換する
- 読者を引き込むリード文から始め、論理的に展開し、余韻の残る締めで終わる
- 会話の流れをそのまま再現するのではなく、読者にとって最も分かりやすい構成に再編集する
- 見出しは内容を端的に表す魅力的なものにする
</rules>

<output_format>
# （記事タイトル — 内容を端的に表す魅力的なタイトル）

（リード文: 読者の関心を引く導入。2-3文で記事の核心を予告する）

## （セクション見出し1）

（本文: 話者の発言や洞察を活かしながら、読みやすい段落に構成。必要に応じて「」で印象的な発言を引用）

## （セクション見出し2）

（本文）

（必要なだけセクションを追加）

## まとめ

（記事全体の要点を凝縮し、読者への問いかけや示唆で締める）
</output_format>`,
  },
  {
    name: 'インタビュー・QA',
    description: 'インタビューや質疑応答をQ&A形式で読みやすく整形',
    is_default: 0,
    system_prompt: `あなたはインタビュー記事の編集専門家です。以下の文字起こしデータを、読みやすいQ&A形式のインタビュー記事に整形してください。

<rules>
- 質問と回答の対応関係を正確に保つ。文脈で補完が必要な場合は[編集注: ...]で補足する
- フィラー（「えー」「あの」「まあ」）や言い直しは除去するが、話者の個性的な表現や口調はできるだけ活かす
- 回答が長い場合は段落分けし、要点が伝わりやすくする。ただし意味の省略や改変はしない
- 話題が前後する場合はテーマごとに再配置してよいが、各回答の内容は変えない
- 発言にない情報は絶対に追加しない
</rules>

<output_format>
## インタビュー概要
- **話者**: （判別できた名前や役割）
- **テーマ**: インタビューの主題
- **ポイント**: 3つ以内の要点を箇条書き

---

### （テーマ1の見出し）

**Q: （質問を明確に整形）**

A: （回答をフィラー除去・段落整理した上で、話者の言葉を活かして記載）

### （テーマ2の見出し）

**Q: （質問）**

A: （回答）

（すべてのQ&Aを整理）

---

## 編集メモ
- 不明瞭だった箇所や確認が必要な点があれば記載
</output_format>`,
  },
  {
    name: '書き起こし整形',
    description: 'フィラー・誤字のみ修正した忠実なクリーン書き起こし',
    is_default: 0,
    system_prompt: `あなたは文字起こしの校正専門家です。以下の文字起こしデータを、読みやすく整形してください。

<rules>
- 【最重要】内容の要約・省略・再構成は絶対にしない。すべての発言を忠実に残す
- 除去してよいもの: フィラー（「えー」「あの」「えっと」「まあ」「うん」「なんか」「こう」「やっぱ」「ほんとに」等の無意味な繰り返し）、言い直しの途中部分、明らかな重複
- 修正してよいもの: 音声認識の明らかな誤変換、句読点の追加、助詞の補完（意味が通らない場合のみ）
- 修正に自信がない箇所は [不明] または [要確認: 元の表記] と注記する
- 話者の口調・方言・個性的な表現はそのまま残す
- 段落分けは話題の切れ目で行う。1段落が長すぎないようにする
- 話者ラベルは元のまま保持する
</rules>

<output_format>
（話者ラベル付きで、整形済みの書き起こしテキストをそのまま出力。セクション見出しや要約は不要）

例:
**speaker_0:** 今日はプロジェクトの進捗について話しましょう。まず開発チームの状況からお願いします。

**speaker_1:** はい。先週からAPIの実装を進めていて、認証部分は完了しました。今週中にテストを終わらせる予定です。

（最後に）
---
**整形メモ**: 修正した箇所の要約（例: フィラー除去 約30箇所、誤変換修正 5箇所）
</output_format>`,
  },
  {
    name: '一人称エッセイ',
    description: '話者の視点で主観的なエッセイ・日記風に書き起こし',
    is_default: 0,
    system_prompt: `あなたはゴーストライターです。以下の文字起こしデータを、話者本人が書いたかのような一人称のエッセイに変換してください。

<rules>
- 「私」の視点で、話者の思考・感情・体験をそのまま追体験するように書く
- 話者が複数いる場合は、最も多く発言している話者の視点を採用する
- 話者の個性（口調、価値観、思考パターン）を文体に反映させる
- 文字起こしに含まれない事実・感情・思考は追加しない
- 会話の相手の発言は、語り手の視点から自然に織り込む（「〜と言われて」「〜という話になり」等）
- です/ます調で、読みやすいエッセイ文体にする
- 時系列は会話の流れに沿いつつ、エッセイとして自然な構成に再編集してよい
</rules>

<output_format>
# （エッセイタイトル — 内容を表す個人的なトーンのタイトル）

（冒頭: その日の状況や気持ちを描写する導入）

（本文: 体験・対話・気づきを一人称で綴る。段落ごとにテーマが自然に移り変わるように）

（締め: 個人的な振り返りや今後への思い）
</output_format>`,
  },
  {
    name: 'タスク抽出',
    description: 'TODO・アクションアイテム・決定事項を自動抽出',
    is_default: 0,
    system_prompt: `あなたはプロジェクト管理のアシスタントです。以下の文字起こしデータから、すべてのタスク・決定事項・宿題を正確に抽出してください。

<rules>
- 明示的なタスク（「〜してください」「〜をやる」）だけでなく、暗黙的なタスク（「〜したほうがいい」「〜が必要」「〜を考えないと」）も拾い上げる
- タスクの担当者・期限は、会話中に言及がある場合のみ記載。推測しない
- 文字起こしに含まれない情報は絶対に追加しない
- 優先度は会話のニュアンス（緊急度を示す表現、繰り返し言及）から判断する
</rules>

<output_format>
## 決定事項
1. （確定した内容。発言者が判別できれば併記）
2. ...

## TODOリスト

| # | タスク | 担当 | 期限 | 優先度 |
|---|--------|------|------|--------|
| 1 | 具体的なタスク内容 | （判別できれば） | （言及があれば） | 高/中/低 |

## 保留・要検討
- まだ結論が出ていない事項と、その論点

## 依存関係・注意点
- タスク間の前後関係や、実行時の注意事項
</output_format>`,
  },
  {
    name: '感情・トーン分析',
    description: '会話の感情トーン・参加者のスタンス・関係性を分析',
    is_default: 0,
    system_prompt: `あなたは対人コミュニケーションの分析専門家です。以下の文字起こしデータから、会話の感情的側面を多角的に分析してください。

<rules>
- 分析は文字起こしの内容に基づく。過度な深読みや決めつけはしない
- 断定が難しい場合は「〜と思われる」「〜の可能性がある」と表現する
- 具体的な発言を引用して根拠を示す
- ネガティブな分析も正直に記載するが、建設的な視点を添える
</rules>

<output_format>
## 会話の全体像
- **トーン**: 一言で表現（例: 前向きだが慎重、活発で対立含み）
- **テーマ**: 何について話していたか
- **雰囲気の変化**: 会話中にトーンが変わった箇所があれば

## 参加者分析

### （話者ラベル/名前）
- **スタンス**: 肯定的 / 慎重 / 批判的 / 中立 / 提案型 / 受動的
- **主な主張**: 2-3文で要約
- **特徴的な発言**: 印象的なフレーズを引用
- **感情の推移**: 会話を通じてのトーン変化

（参加者ごとに繰り返し）

## 注目すべきダイナミクス
- 合意形成のプロセス
- 意見の対立点とその展開
- 暗黙の前提や言外のメッセージ

## 建設的な所見
- この会話から読み取れるチームや関係性の強み
- より良いコミュニケーションへの示唆（あれば）
</output_format>`,
  },
];

function runMigrations() {
  // Add refined_segments_json column if missing
  try {
    const cols = db.exec("PRAGMA table_info(transcriptions)");
    const colNames = cols[0]?.values?.map(r => r[1]) || [];
    if (!colNames.includes('refined_segments_json')) {
      db.run('ALTER TABLE transcriptions ADD COLUMN refined_segments_json TEXT');
      save();
      console.log('[Migration] Added refined_segments_json column');
    }
  } catch (e) {
    console.warn('[Migration] refined_segments_json check failed:', e.message);
  }

  // Add importance column to recordings if missing
  try {
    const recCols = db.exec("PRAGMA table_info(recordings)");
    const recColNames = recCols[0]?.values?.map(r => r[1]) || [];
    if (!recColNames.includes('importance')) {
      db.run('ALTER TABLE recordings ADD COLUMN importance INTEGER DEFAULT 1');
      save();
      console.log('[Migration] Added importance column');
    }
    if (!recColNames.includes('processed_locally')) {
      db.run('ALTER TABLE recordings ADD COLUMN processed_locally INTEGER DEFAULT 0');
      save();
      console.log('[Migration] Added processed_locally column');
    }
    if (!recColNames.includes('summary_segment_ids_json')) {
      db.run('ALTER TABLE recordings ADD COLUMN summary_segment_ids_json TEXT');
      save();
      console.log('[Migration] Added summary_segment_ids_json column');
    }
    if (!recColNames.includes('original_filename')) {
      db.run('ALTER TABLE recordings ADD COLUMN original_filename TEXT');
      save();
      console.log('[Migration] Added original_filename column');
    }
    if (!recColNames.includes('refine_warning')) {
      // Stores JSON: { type: 'fallback' | 'failed', primary, fallback?, reason, at, acknowledged?: 0 }
      db.run('ALTER TABLE recordings ADD COLUMN refine_warning TEXT');
      save();
      console.log('[Migration] Added refine_warning column');
    }
    if (!recColNames.includes('archived_at')) {
      // NULL = active. ISO-8601 timestamp = when the user archived this recording.
      // Archived recordings are hidden from the dashboard and from search by default.
      db.run('ALTER TABLE recordings ADD COLUMN archived_at DATETIME');
      save();
      console.log('[Migration] Added archived_at column');
    }
    if (!recColNames.includes('trashed_at')) {
      // NULL = not in trash. ISO-8601 timestamp = when the user moved it to trash.
      // Trashed recordings are auto-deleted after `trash_retention_days` (see settings).
      db.run('ALTER TABLE recordings ADD COLUMN trashed_at DATETIME');
      save();
      console.log('[Migration] Added trashed_at column');
    }
  } catch (e) {
    console.warn('[Migration] recordings columns check failed:', e.message);
  }

  // Add sort_order to templates + deduplicate is_default
  try {
    const tplCols = db.exec("PRAGMA table_info(templates)");
    const tplColNames = tplCols[0]?.values?.map(r => r[1]) || [];
    if (!tplColNames.includes('sort_order')) {
      db.run('ALTER TABLE templates ADD COLUMN sort_order INTEGER DEFAULT 0');
      // Initialize sort_order by current id
      db.run('UPDATE templates SET sort_order = id WHERE sort_order = 0');
      save();
      console.log('[Migration] Added sort_order column to templates');
    }

    // Ensure only one is_default template (keep the lowest id)
    const defaults = db.exec("SELECT id FROM templates WHERE is_default = 1 ORDER BY id");
    const defaultIds = defaults[0]?.values?.map(r => r[0]) || [];
    if (defaultIds.length > 1) {
      const keepId = defaultIds[0];
      db.run('UPDATE templates SET is_default = 0 WHERE id != ?', [keepId]);
      save();
      console.log(`[Migration] Deduplicated is_default (kept template ${keepId})`);
    }
  } catch (e) {
    console.warn('[Migration] templates migration failed:', e.message);
  }

  // Add chat_messages table if missing
  try {
    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_chat_messages_recording ON chat_messages(recording_id)');
  } catch (e) {
    // Already exists
  }

  // Add cross_chat_messages table if missing
  try {
    db.run(`CREATE TABLE IF NOT EXISTS cross_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      scope_json TEXT,
      referenced_recordings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_cross_chat_session ON cross_chat_messages(session_id)');
  } catch (e) {
    // Already exists
  }
}

function seedTemplates() {
  const count = queryOne('SELECT COUNT(*) as c FROM templates')?.c || 0;
  if (count > 0) return;

  for (const t of ALL_TEMPLATES) {
    execute(
      'INSERT INTO templates (name, description, system_prompt, output_format, is_default) VALUES (?, ?, ?, ?, ?)',
      [t.name, t.description, t.system_prompt, 'markdown', t.is_default || 0]
    );
  }
}

function seedNewTemplates() {
  // Upsert: add missing templates, update existing ones with improved prompts
  for (const t of ALL_TEMPLATES) {
    const existing = queryOne('SELECT id FROM templates WHERE name = ?', [t.name]);
    if (!existing) {
      execute(
        'INSERT INTO templates (name, description, system_prompt, output_format, is_default) VALUES (?, ?, ?, ?, ?)',
        [t.name, t.description, t.system_prompt, 'markdown', t.is_default || 0]
      );
    } else {
      // Update existing template with improved prompt
      execute(
        'UPDATE templates SET description = ?, system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [t.description, t.system_prompt, existing.id]
      );
    }
  }

  // Remove old templates that are no longer in the list
  const oldNames = ['1on1メモ', 'ブレスト要約', 'フリーフォーマット', '議事録（簡易）', '議事録（通常）', '議事録（詳細）'];
  for (const name of oldNames) {
    execute('DELETE FROM templates WHERE name = ?', [name]);
  }
}

function seedSettings() {
  const count = queryOne('SELECT COUNT(*) as c FROM settings')?.c || 0;
  if (count > 0) return;

  const defaults = {
    default_transcription_engine: 'openai',
    default_summary_provider: 'openai',
    default_summary_model: 'gpt-5.4-mini',
    default_language: 'auto',
    diarization_enabled: 'true',
    data_dir: path.dirname(DB_PATH),
    subscription_tier: '',
    // Trash behavior
    trash_retention_days: 14,          // 1..30
    trash_delete_mode: 'complete',     // 'complete' | 'audio_only'
  };

  for (const [key, value] of Object.entries(defaults)) {
    execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
}
