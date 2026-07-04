import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { queryOne } from '../../db/database.js';
import { getAppDataDir } from '../../utils/platform-paths.js';

// whisper.cpp release info
const WHISPER_CPP_VERSION = '1.8.4';
const WHISPER_CPP_BASE_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/v${WHISPER_CPP_VERSION}`;
const WHISPER_CPP_ZIP = `whisper-bin-x64.zip`;
const WHISPER_CLI_EXE = 'whisper-cli.exe';

// Model URLs (GGML format from Hugging Face)
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
const MODELS = {
  'tiny':     { file: 'ggml-tiny.bin',     size: '75 MB' },
  'base':     { file: 'ggml-base.bin',     size: '148 MB' },
  'small':    { file: 'ggml-small.bin',    size: '488 MB' },
  'medium':   { file: 'ggml-medium.bin',   size: '1.5 GB' },
  'large-v3': { file: 'ggml-large-v3.bin', size: '3.1 GB' },
};

/**
 * Get the whisper.cpp install directory.
 * Uses DATA_DIR/whisper-cpp/ so it persists across app updates.
 */
function getWhisperDir() {
  const dir = path.resolve(getAppDataDir(), 'whisper-cpp');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getModelsDir() {
  const dir = path.join(getWhisperDir(), 'models');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getMainExePath() {
  return path.join(getWhisperDir(), WHISPER_CLI_EXE);
}

/**
 * Check if whisper.cpp binary is installed.
 */
export function isWhisperCppInstalled() {
  return existsSync(getMainExePath());
}

/**
 * Check which models are downloaded.
 */
export function getInstalledModels() {
  const modelsDir = getModelsDir();
  const installed = [];
  for (const [name, info] of Object.entries(MODELS)) {
    const modelPath = path.join(modelsDir, info.file);
    if (existsSync(modelPath)) {
      const stat = fs.statSync(modelPath);
      installed.push({ name, file: info.file, size: info.size, downloadedSize: stat.size });
    }
  }
  return installed;
}

/**
 * Get full status of whisper.cpp installation.
 */
export function getWhisperCppStatus() {
  return {
    installed: isWhisperCppInstalled(),
    models: getInstalledModels(),
    availableModels: Object.entries(MODELS).map(([name, info]) => ({
      name,
      file: info.file,
      size: info.size,
    })),
    dir: getWhisperDir(),
  };
}

/**
 * Download a file with progress callback.
 */
async function downloadFile(url, destPath, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);

  const totalSize = parseInt(res.headers.get('content-length') || '0', 10);
  let downloaded = 0;

  const destStream = createWriteStream(destPath);
  const reader = res.body.getReader();

  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
        return;
      }
      downloaded += value.length;
      if (onProgress && totalSize > 0) {
        onProgress(downloaded, totalSize);
      }
      this.push(Buffer.from(value));
    }
  });

  await pipeline(nodeStream, destStream);
  return destPath;
}

/**
 * Download and extract whisper.cpp binary.
 */
export async function downloadWhisperCpp(onProgress) {
  const whisperDir = getWhisperDir();
  const zipUrl = `${WHISPER_CPP_BASE_URL}/${WHISPER_CPP_ZIP}`;
  const zipPath = path.join(whisperDir, WHISPER_CPP_ZIP);

  console.log(`[whisper.cpp] Downloading binary from ${zipUrl}`);
  if (onProgress) onProgress({ stage: 'binary', status: 'downloading', progress: 0 });

  await downloadFile(zipUrl, zipPath, (downloaded, total) => {
    if (onProgress) onProgress({ stage: 'binary', status: 'downloading', progress: downloaded / total });
  });

  // Extract zip
  if (onProgress) onProgress({ stage: 'binary', status: 'extracting' });
  console.log('[whisper.cpp] Extracting...');

  // Use PowerShell to extract (available on all Windows 10+)
  await new Promise((resolve, reject) => {
    const proc = spawn('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${whisperDir}' -Force`
    ], { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Extraction failed: ${stderr}`));
      else resolve();
    });
    proc.on('error', reject);
  });

  // Clean up zip
  try { fs.unlinkSync(zipPath); } catch {}

  // Verify whisper-cli.exe exists
  if (!existsSync(getMainExePath())) {
    // The zip extracts into a Release/ subdirectory — find whisper-cli.exe
    const findExe = (dir) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name === WHISPER_CLI_EXE) {
            return path.join(dir, entry.name);
          }
          if (entry.isDirectory()) {
            const found = findExe(path.join(dir, entry.name));
            if (found) return found;
          }
        }
      } catch {}
      return null;
    };

    const foundExe = findExe(whisperDir);
    if (foundExe && foundExe !== getMainExePath()) {
      // Move ALL files (including DLLs) from subdirectory to whisperDir
      const subDir = path.dirname(foundExe);
      for (const f of fs.readdirSync(subDir)) {
        const src = path.join(subDir, f);
        const dest = path.join(whisperDir, f);
        if (src !== dest) {
          try { fs.renameSync(src, dest); } catch {
            // If rename fails, try copy + delete
            try {
              fs.copyFileSync(src, dest);
              fs.unlinkSync(src);
            } catch {}
          }
        }
      }
      // Clean up empty subdirectory
      try { fs.rmdirSync(subDir); } catch {}
    }
  }

  if (!existsSync(getMainExePath())) {
    throw new Error(`whisper.cpp ${WHISPER_CLI_EXE} が見つかりません。ダウンロードに失敗した可能性があります。`);
  }

  if (onProgress) onProgress({ stage: 'binary', status: 'done' });
  console.log('[whisper.cpp] Binary installed successfully');
}

/**
 * Download a whisper model.
 */
export async function downloadModel(modelName, onProgress) {
  const modelInfo = MODELS[modelName];
  if (!modelInfo) throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(MODELS).join(', ')}`);

  const modelsDir = getModelsDir();
  const modelPath = path.join(modelsDir, modelInfo.file);

  if (existsSync(modelPath)) {
    console.log(`[whisper.cpp] Model ${modelName} already downloaded`);
    return modelPath;
  }

  const url = `${MODEL_BASE_URL}/${modelInfo.file}`;
  console.log(`[whisper.cpp] Downloading model ${modelName} (${modelInfo.size}) from ${url}`);

  if (onProgress) onProgress({ stage: 'model', model: modelName, status: 'downloading', progress: 0 });

  await downloadFile(url, modelPath, (downloaded, total) => {
    if (onProgress) onProgress({ stage: 'model', model: modelName, status: 'downloading', progress: downloaded / total });
  });

  if (onProgress) onProgress({ stage: 'model', model: modelName, status: 'done' });
  console.log(`[whisper.cpp] Model ${modelName} downloaded successfully`);
  return modelPath;
}

/**
 * Resolve which whisper model to actually use:
 *   1. options.model (explicit override from caller)
 *   2. settings.local_whisper_model
 *   3. Largest installed model (best quality the user has on disk)
 *   4. 'base' (will trigger a clear "not downloaded" error if missing)
 */
function resolveModel(options) {
  // Explicit override
  if (options.model && MODELS[options.model]) {
    const p = path.join(getModelsDir(), MODELS[options.model].file);
    if (existsSync(p)) return { name: options.model, path: p };
  }

  // User's saved default
  const modelSetting = queryOne("SELECT value FROM settings WHERE key = 'local_whisper_model'");
  let savedModel = null;
  if (modelSetting) {
    try { savedModel = JSON.parse(modelSetting.value); } catch { savedModel = modelSetting.value; }
  }
  if (savedModel && MODELS[savedModel]) {
    const p = path.join(getModelsDir(), MODELS[savedModel].file);
    if (existsSync(p)) return { name: savedModel, path: p };
  }

  // Otherwise, pick whatever the user has actually downloaded.
  // Prefer larger models (better quality) for best chance of success.
  const ORDER = ['large-v3', 'medium', 'small', 'base', 'tiny'];
  for (const name of ORDER) {
    const p = path.join(getModelsDir(), MODELS[name].file);
    if (existsSync(p)) return { name, path: p };
  }

  return null;
}

// Chunked transcription settings.
// whisper.cpp CPU decoding of long audio can legitimately take hours (large-v3
// runs near realtime on 8 threads), so there must be NO fixed wall-clock limit.
// Instead: split audio into chunks (bounds memory, gives per-chunk progress)
// and kill only when the process stops producing output entirely.
const CHUNK_SEC = 600;                    // 10-minute chunks
const STALL_TIMEOUT_MS = 10 * 60 * 1000;  // no stdout/stderr for 10 min = stalled

/**
 * Duration in seconds of a 16kHz mono s16le WAV produced by our ffmpeg calls.
 * Used to accumulate exact chunk offsets (segment_time is not sample-exact).
 */
function wavDurationSec(wavPath) {
  try {
    const bytes = fs.statSync(wavPath).size - 44; // 44-byte canonical WAV header
    return Math.max(0, bytes / (16000 * 2));
  } catch {
    return 0;
  }
}

/**
 * Split audio into 16kHz mono WAV chunks via ffmpeg's segment muxer.
 * whisper.cpp 1.8.x officially supports only WAV PCM; .webm produced by browser
 * MediaRecorder uses Opus and silently produces empty output if fed directly,
 * so conversion happens here in the same pass as the split.
 * Returns { dir, chunks } — caller must remove dir when done.
 */
async function segmentAudio(audioPath, ffmpegCmd, chunkSec) {
  const dir = path.join(path.dirname(audioPath), `_whispercpp_chunks_${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const pattern = path.join(dir, 'chunk_%04d.wav');

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegCmd, [
      '-y',
      '-i', audioPath,
      '-ar', '16000',   // 16kHz
      '-ac', '1',       // mono
      '-c:a', 'pcm_s16le',
      '-f', 'segment',
      '-segment_time', String(chunkSec),
      '-reset_timestamps', '1',
      pattern,
    ], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-300)}`));
    });
  });

  const chunks = fs.readdirSync(dir)
    .filter((f) => f.startsWith('chunk_') && f.endsWith('.wav'))
    .sort()
    .map((f) => path.join(dir, f));
  if (chunks.length === 0) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    throw new Error('ffmpegが音声チャンクを生成できませんでした。音声ファイルが破損している可能性があります。');
  }
  return { dir, chunks };
}

async function findFfmpeg() {
  // 1. PATH
  for (const cmd of ['ffmpeg', 'ffmpeg.exe']) {
    try {
      const ok = await new Promise((resolve) => {
        const p = spawn(cmd, ['-version'], { windowsHide: true });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
      if (ok) return cmd;
    } catch {}
  }
  // 2. Common Windows install locations
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-7.1-full_build', 'bin', 'ffmpeg.exe'),
    ].filter(Boolean);
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }
  return null;
}

/**
 * Parse whisper-cli output into segments.
 * Primary: the JSON file written via -of. Fallback: [ts --> ts] stdout lines.
 */
function parseWhisperOutput(jsonPath, stdout, fallbackLanguage) {
  if (existsSync(jsonPath)) {
    const result = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    try { fs.unlinkSync(jsonPath); } catch {}

    const segments = [];
    const transcription = result.transcription || result.segments || [];
    for (const seg of transcription) {
      const text = (seg.text || '').trim();
      if (!text) continue;

      // Prefer millisecond offsets, then HH:MM:SS timestamps, then centiseconds
      const start = seg.offsets?.from != null
        ? seg.offsets.from / 1000
        : seg.timestamps?.from
          ? parseTimestamp(seg.timestamps.from)
          : (seg.start || seg.t0 || 0) / 100;
      const end = seg.offsets?.to != null
        ? seg.offsets.to / 1000
        : seg.timestamps?.to
          ? parseTimestamp(seg.timestamps.to)
          : (seg.end || seg.t1 || 0) / 100;

      segments.push({
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        speaker: 'speaker_0',
        text,
      });
    }
    return { segments, language: result.result?.language || fallbackLanguage };
  }

  // Fallback: parse text output line by line
  const segments = [];
  const timeRegex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;
  for (const line of stdout.split('\n')) {
    const match = line.match(timeRegex);
    if (match) {
      segments.push({
        start: parseTimestamp(match[1]),
        end: parseTimestamp(match[2]),
        speaker: 'speaker_0',
        text: match[3].trim(),
      });
    }
  }
  if (segments.length === 0) {
    throw new Error(`whisper.cppの出力を解析できません:\n${stdout.slice(0, 500)}`);
  }
  return { segments, language: fallbackLanguage };
}

/**
 * Run whisper-cli on a single WAV file. Returns { segments, language }.
 * No fixed wall-clock timeout (long audio legitimately takes hours on CPU);
 * a stall watchdog kills the process only when it stops producing output.
 */
function runWhisperCli({ wavPath, modelPath, language, threads, label = '' }) {
  const outPrefix = wavPath.replace(/\.wav$/i, '') + '_out';
  const jsonPath = `${outPrefix}.json`;
  const args = [
    '-m', modelPath,
    '-f', wavPath,
    '--output-json',      // JSON is the primary output we parse
    '-of', outPrefix,     // explicit output path (default derives from -f and broke for temp files)
    '-pp',                // print progress (also feeds the stall watchdog)
    '-t', String(threads),
    '-l', language,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(getMainExePath(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let lastOutputAt = Date.now();
    let killedForStall = false;

    const watchdog = setInterval(() => {
      if (Date.now() - lastOutputAt > STALL_TIMEOUT_MS) {
        killedForStall = true;
        try { proc.kill(); } catch {}
      }
    }, 30000);

    proc.stdout.on('data', (data) => {
      lastOutputAt = Date.now();
      stdout += data.toString();
    });
    proc.stderr.on('data', (data) => {
      lastOutputAt = Date.now();
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[whisper.cpp]${label} ${msg}`);
        stderr += msg + '\n';
      }
    });

    proc.on('error', (err) => {
      clearInterval(watchdog);
      reject(new Error(`whisper.cpp実行エラー: ${err.message}`));
    });

    proc.on('close', (code) => {
      clearInterval(watchdog);
      if (killedForStall) {
        try { fs.unlinkSync(jsonPath); } catch {}
        reject(new Error(`whisper.cppが${Math.round(STALL_TIMEOUT_MS / 60000)}分間応答しないため中断しました`));
        return;
      }
      if (code !== 0) {
        try { fs.unlinkSync(jsonPath); } catch {}
        reject(new Error(`whisper.cppが異常終了しました (code ${code})\n${stderr.slice(-500)}`));
        return;
      }
      try {
        resolve(parseWhisperOutput(jsonPath, stdout, language));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

/**
 * Transcribe audio using whisper.cpp binary.
 * Long audio is split into CHUNK_SEC chunks and transcribed sequentially so
 * that memory use and failure impact stay independent of recording length.
 */
export async function transcribeWithWhisperCpp(audioPath, options = {}) {
  if (!isWhisperCppInstalled()) {
    throw new Error('whisper.cpp がインストールされていません。設定画面からセットアップしてください。');
  }

  const resolved = resolveModel(options);
  if (!resolved) {
    const installed = getInstalledModels().map(m => m.name).join(', ') || '(なし)';
    throw new Error(
      `whisper.cppのモデルがダウンロードされていません。\n` +
      `インストール済み: ${installed}\n` +
      `設定画面 → whisper.cpp セクションから tiny / base / small / medium / large-v3 のいずれかをDLしてください。`
    );
  }
  const modelName = resolved.name;
  const modelPath = resolved.path;

  const remedy = 'ヒント: 設定画面で小さいWhisperモデル（medium / small）に切り替えるか、クラウド文字起こしで再実行してください。';
  const threads = Math.max(1, Math.floor(os.cpus().length / 2)); // half of CPU cores
  const requestedLang = (!options.language || options.language === 'auto') ? 'auto' : options.language;
  const chunkSec = options.chunkSec || CHUNK_SEC;
  const ffmpegCmd = await findFfmpeg();

  const buildResult = (segments, detectedLang, chunkCount) => ({
    engine: 'whisper-cpp',
    language: detectedLang,
    segments,
    speakers: [{ id: 'speaker_0', label: 'speaker_0' }],
    raw_response: { model: modelName, chunks: chunkCount, chunk_sec: chunkSec },
  });

  if (!ffmpegCmd) {
    if (path.extname(audioPath).toLowerCase() !== '.wav') {
      throw new Error(
        'whisper.cpp で .webm / .mp3 / .m4a / .ogg / .flac を扱うには ffmpeg が必要です。\n' +
        '推奨: winget install ffmpeg または https://www.gyan.dev/ffmpeg/builds/ から取得して PATH に追加してください。'
      );
    }
    // Legacy single-pass path: without ffmpeg we cannot split, so run whole file
    console.log(`[whisper.cpp] Transcribing (no ffmpeg, single pass): model=${modelName}, language=${requestedLang}, audio=${audioPath}`);
    try {
      const out = await runWhisperCli({ wavPath: audioPath, modelPath, language: requestedLang, threads });
      return buildResult(out.segments, out.language, 1);
    } catch (err) {
      throw new Error(`${err.message}\n${remedy}`);
    }
  }

  const { dir, chunks } = await segmentAudio(audioPath, ffmpegCmd, chunkSec);
  console.log(`[whisper.cpp] Transcribing: model=${modelName}, language=${requestedLang}, chunks=${chunks.length} x ~${chunkSec}s, audio=${audioPath}`);

  try {
    const allSegments = [];
    let offsetSec = 0;
    let effectiveLang = requestedLang; // lock in detected language after chunk 1
    let detectedLang = requestedLang;

    for (let i = 0; i < chunks.length; i++) {
      const label = chunks.length > 1 ? ` [${i + 1}/${chunks.length}]` : '';
      let out;
      try {
        out = await runWhisperCli({ wavPath: chunks[i], modelPath, language: effectiveLang, threads, label });
      } catch (err) {
        const where = chunks.length > 1 ? `チャンク ${i + 1}/${chunks.length} で失敗 (model=${modelName})\n` : '';
        throw new Error(`${where}${err.message}\n${remedy}`);
      }

      if (i === 0 && effectiveLang === 'auto' && out.language && out.language !== 'auto') {
        effectiveLang = out.language; // consistent language + skips re-detection on later chunks
        detectedLang = out.language;
      }

      // whisper pads to 30s windows, so a chunk's final segment can claim an
      // end time past the chunk's real duration — clamp to avoid overlapping
      // the next chunk's timestamps
      const chunkDur = wavDurationSec(chunks[i]) || chunkSec;
      for (const seg of out.segments) {
        const end = Math.min(seg.end, chunkDur);
        allSegments.push({
          ...seg,
          start: Math.round((Math.min(seg.start, end) + offsetSec) * 100) / 100,
          end: Math.round((end + offsetSec) * 100) / 100,
        });
      }
      offsetSec += chunkDur;
    }

    return buildResult(allSegments, detectedLang, chunks.length);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Parse HH:MM:SS.mmm timestamp to seconds.
 */
function parseTimestamp(ts) {
  if (typeof ts === 'number') return ts;
  const parts = ts.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return parseFloat(ts) || 0;
}
