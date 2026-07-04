import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import initSqlJs from 'sql.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDbPath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'VoiceScope', 'data', 'voicescope.db');
const fallbackDbPath = path.join(repoRoot, 'data', 'voicescope.db');

const dbPath = path.resolve(process.argv[2] || (fs.existsSync(defaultDbPath) ? defaultDbPath : fallbackDbPath));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const outRoot = path.resolve(process.argv[3] || path.join(repoRoot, 'exports', `transcripts_${stamp}`));
const latestDir = path.join(outRoot, 'latest');
const versionsDir = path.join(outRoot, 'all_versions');

function safeName(value, fallback) {
  const base = String(value || fallback || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return base || fallback || 'untitled';
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function datePrefix(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return 'unknown_date';
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatTime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '00:00';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function transcriptText(segments, speakers) {
  const speakerMap = new Map();
  for (const speaker of Array.isArray(speakers) ? speakers : []) {
    if (speaker?.id) speakerMap.set(speaker.id, speaker.name || speaker.label || speaker.id);
  }

  const hasSpeakers = Array.isArray(speakers) && speakers.length > 1;
  return (Array.isArray(segments) ? segments : [])
    .map((seg) => {
      const text = String(seg?.text || '').trim();
      if (!text) return '';
      const time = formatTime(seg?.start ?? 0);
      const speaker = speakerMap.get(seg?.speaker) || seg?.speaker;
      return hasSpeakers && speaker
        ? `[${time}] ${speaker}: ${text}`
        : `[${time}] ${text}`;
    })
    .filter(Boolean)
    .join('\n');
}

function rowObject(columns, values) {
  const obj = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  return obj;
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(latestDir, { recursive: true });
fs.mkdirSync(versionsDir, { recursive: true });

const SQL = await initSqlJs();
const db = new SQL.Database(fs.readFileSync(dbPath));

const transCols = db.exec('PRAGMA table_info(transcriptions)')[0]?.values?.map((r) => r[1]) || [];
const hasRefined = transCols.includes('refined_segments_json');
const refinedSelect = hasRefined ? 't.refined_segments_json' : 'NULL AS refined_segments_json';

const result = db.exec(`
  SELECT
    t.id AS transcription_id,
    t.recording_id,
    t.engine,
    t.language,
    t.segments_json,
    ${refinedSelect},
    t.speakers_json,
    t.created_at AS transcription_created_at,
    r.title,
    r.recorded_at,
    r.original_filename,
    r.file_path
  FROM transcriptions t
  LEFT JOIN recordings r ON r.id = t.recording_id
  ORDER BY r.recorded_at ASC, t.created_at ASC, t.id ASC
`);

const rows = result[0]
  ? result[0].values.map((values) => rowObject(result[0].columns, values))
  : [];

const latestByRecording = new Map();
const manifest = [];

for (const row of rows) {
  latestByRecording.set(row.recording_id, row);
}

let versionCount = 0;
for (const row of rows) {
  const refinedSegments = parseJson(row.refined_segments_json, null);
  const originalSegments = parseJson(row.segments_json, []);
  const selectedSegments = Array.isArray(refinedSegments) && refinedSegments.length > 0 ? refinedSegments : originalSegments;
  const source = selectedSegments === refinedSegments ? 'refined' : 'original';
  const speakers = parseJson(row.speakers_json, []);
  const title = row.title || row.original_filename || row.recording_id;
  const prefix = datePrefix(row.recorded_at || row.transcription_created_at);
  const fileBase = `${prefix}_${safeName(title, row.recording_id)}_t${row.transcription_id}`;
  const fileName = `${fileBase}.txt`;
  const content = [
    `タイトル: ${title || ''}`,
    `録音ID: ${row.recording_id}`,
    `文字起こしID: ${row.transcription_id}`,
    `録音日時: ${row.recorded_at || ''}`,
    `文字起こし日時: ${row.transcription_created_at || ''}`,
    `エンジン: ${row.engine || ''}`,
    `言語: ${row.language || ''}`,
    `使用テキスト: ${source}`,
    `元ファイル: ${row.original_filename || row.file_path || ''}`,
    '',
    transcriptText(selectedSegments, speakers),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(versionsDir, fileName), content, 'utf8');
  versionCount++;
}

let latestCount = 0;
for (const row of latestByRecording.values()) {
  const refinedSegments = parseJson(row.refined_segments_json, null);
  const originalSegments = parseJson(row.segments_json, []);
  const selectedSegments = Array.isArray(refinedSegments) && refinedSegments.length > 0 ? refinedSegments : originalSegments;
  const source = selectedSegments === refinedSegments ? 'refined' : 'original';
  const speakers = parseJson(row.speakers_json, []);
  const title = row.title || row.original_filename || row.recording_id;
  const prefix = datePrefix(row.recorded_at || row.transcription_created_at);
  const fileName = `${prefix}_${safeName(title, row.recording_id)}.txt`;
  const content = [
    `タイトル: ${title || ''}`,
    `録音ID: ${row.recording_id}`,
    `文字起こしID: ${row.transcription_id}`,
    `録音日時: ${row.recorded_at || ''}`,
    `文字起こし日時: ${row.transcription_created_at || ''}`,
    `エンジン: ${row.engine || ''}`,
    `言語: ${row.language || ''}`,
    `使用テキスト: ${source}`,
    `元ファイル: ${row.original_filename || row.file_path || ''}`,
    '',
    transcriptText(selectedSegments, speakers),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(latestDir, fileName), content, 'utf8');
  latestCount++;
  manifest.push({
    recording_id: row.recording_id,
    transcription_id: row.transcription_id,
    title,
    recorded_at: row.recorded_at,
    exported_file: path.join('latest', fileName),
    source,
  });
}

fs.writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
fs.writeFileSync(
  path.join(outRoot, 'README.txt'),
  [
    'VoiceScope transcription export',
    `Source DB: ${dbPath}`,
    `Exported at: ${new Date().toISOString()}`,
    '',
    'latest:',
    '  One txt file per recording. Uses refined transcript when available.',
    '',
    'all_versions:',
    '  One txt file per transcription row, including older re-transcription history.',
    '',
  ].join('\n'),
  'utf8',
);

db.close();

console.log(JSON.stringify({
  dbPath,
  outRoot,
  latestCount,
  versionCount,
}, null, 2));
