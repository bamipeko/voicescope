import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_PATH = path.resolve(DATA_DIR, 'voicescope.db');

let db = null;

export async function initDatabase() {
  // Locate sql.js WASM binary - handle both normal and Electron asar-unpacked paths
  let wasmUrl;
  try {
    const sqlJsDir = path.dirname(new URL(import.meta.resolve('sql.js')).pathname);
    // On Windows, URL pathname starts with /C: — strip the leading /
    const cleanDir = process.platform === 'win32' ? sqlJsDir.replace(/^\//, '') : sqlJsDir;
    const wasmPath = path.join(cleanDir, 'sql-wasm.wasm');
    if (fs.existsSync(wasmPath)) {
      wasmUrl = wasmPath;
    }
    // Also check unpacked path for Electron
    if (!wasmUrl) {
      const unpackedPath = wasmPath.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedPath)) {
        wasmUrl = unpackedPath;
      }
    }
  } catch (e) {
    // Fallback: let sql.js find it automatically
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

  // Run schema (handle asar.unpacked path)
  let schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = schemaPath.replace('app.asar', 'app.asar.unpacked');
  }
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.run(schema);

  // Seed default templates
  seedTemplates();

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

function seedTemplates() {
  const count = queryOne('SELECT COUNT(*) as c FROM templates')?.c || 0;
  if (count > 0) return;

  const templates = [
    {
      name: '議事録',
      description: '会議の参加者・議題・決定事項・アクションアイテムを整理',
      system_prompt: `あなたは会議の議事録作成アシスタントです。以下の文字起こしテキストから、構造化された議事録を作成してください。

出力フォーマット:
## 参加者
## 議題
## 議論内容
## 決定事項
## アクションアイテム（担当者・期限）

簡潔かつ正確に、重要な発言や決定事項を漏らさず記載してください。`,
      output_format: 'markdown',
      is_default: 1,
    },
    {
      name: '1on1メモ',
      description: '1on1ミーティングの話題・フィードバック・ネクストステップを整理',
      system_prompt: `あなたは1on1ミーティングの記録アシスタントです。以下の文字起こしテキストから、1on1の要点をまとめてください。

出力フォーマット:
## 話題
## フィードバック・気づき
## ネクストステップ
## フォローアップ事項

各話題について、誰が何を言ったかを明確に記載してください。`,
      output_format: 'markdown',
      is_default: 0,
    },
    {
      name: 'ブレスト要約',
      description: 'ブレインストーミングのアイデア一覧・評価・優先順位を整理',
      system_prompt: `あなたはブレインストーミングの整理アシスタントです。以下の文字起こしテキストから、出されたアイデアを整理してください。

出力フォーマット:
## テーマ
## アイデア一覧
## 評価・議論のポイント
## 優先順位（高・中・低）
## ネクストステップ

すべてのアイデアを漏れなく拾い上げ、議論の中で出た評価も併記してください。`,
      output_format: 'markdown',
      is_default: 0,
    },
    {
      name: 'フリーフォーマット',
      description: '自由記述の要約',
      system_prompt: `あなたは音声会話の要約アシスタントです。以下の文字起こしテキストを、わかりやすく要約してください。

要約のポイント:
- 主な話題と結論
- 重要な発言や決定事項
- 今後のアクション

Markdown形式で、読みやすく構造化してください。`,
      output_format: 'markdown',
      is_default: 0,
    },
  ];

  for (const t of templates) {
    execute(
      `INSERT INTO templates (name, description, system_prompt, output_format, is_default) VALUES (?, ?, ?, ?, ?)`,
      [t.name, t.description, t.system_prompt, t.output_format, t.is_default]
    );
  }
}

function seedSettings() {
  const count = queryOne('SELECT COUNT(*) as c FROM settings')?.c || 0;
  if (count > 0) return;

  const defaults = {
    default_transcription_engine: 'deepgram',
    default_summary_provider: 'gemini',
    default_summary_model: 'gemini-3.1-flash-lite-preview',
    default_language: 'auto',
    diarization_enabled: 'true',
    data_dir: DATA_DIR,
  };

  for (const [key, value] of Object.entries(defaults)) {
    execute('INSERT INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
}
