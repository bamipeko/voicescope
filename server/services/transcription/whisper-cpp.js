import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
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

/**
 * Convert any audio format whisper.cpp can't reliably read (webm/ogg/m4a/flac
 * with non-standard codecs) into 16kHz mono WAV via ffmpeg. Returns a path to
 * the temp WAV that the caller is responsible for deleting.
 *
 * whisper.cpp 1.8.x officially supports only WAV PCM; .webm produced by browser
 * MediaRecorder uses Opus and silently produces empty output if fed directly.
 */
async function ensureWhisperReadable(audioPath) {
  const ext = path.extname(audioPath).toLowerCase();
  if (ext === '.wav') return { path: audioPath, isTemp: false };

  // Need ffmpeg to convert. Resolve from PATH or from common locations.
  const ffmpegCmd = await findFfmpeg();
  if (!ffmpegCmd) {
    throw new Error(
      'whisper.cpp で .webm / .mp3 / .m4a / .ogg / .flac を扱うには ffmpeg が必要です。\n' +
      '推奨: winget install ffmpeg または https://www.gyan.dev/ffmpeg/builds/ から取得して PATH に追加してください。'
    );
  }

  const tmpWav = path.join(path.dirname(audioPath), `_whispercpp_${Date.now()}.wav`);
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegCmd, [
      '-y',
      '-i', audioPath,
      '-ar', '16000',  // 16kHz
      '-ac', '1',       // mono
      '-c:a', 'pcm_s16le',
      tmpWav,
    ], { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-300)}`));
    });
  });

  return { path: tmpWav, isTemp: true };
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
 * Transcribe audio using whisper.cpp binary.
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

  // Convert non-WAV input via ffmpeg (whisper.cpp 1.8.x only supports WAV PCM)
  const audio = await ensureWhisperReadable(audioPath);

  const language = (!options.language || options.language === 'auto') ? 'auto' : options.language;
  const mainExe = getMainExePath();

  const args = [
    '-m', modelPath,
    '-f', audio.path,
    '--output-json',      // JSON output
    '--no-timestamps',    // We'll use the JSON timestamps
    '-pp',                // Print progress
    '-t', String(Math.max(1, Math.floor((await import('os')).cpus().length / 2))), // Use half of CPU cores
  ];

  if (language !== 'auto') {
    args.push('-l', language);
  } else {
    args.push('-l', 'auto');
  }

  console.log(`[whisper.cpp] Transcribing: model=${modelName}, language=${language}, audio=${audio.path}`);

  // Cleanup helper for the temp WAV (runs on success, error, and parse failures alike)
  const cleanupTempWav = () => {
    if (audio.isTemp) {
      try { fs.unlinkSync(audio.path); } catch {}
    }
  };

  return new Promise((resolve, reject) => {
    const proc = spawn(mainExe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 1800000, // 30 min timeout
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[whisper.cpp] ${msg}`);
        stderr += msg + '\n';
      }
    });

    proc.on('error', (err) => {
      cleanupTempWav();
      reject(new Error(`whisper.cpp実行エラー: ${err.message}`));
    });

    proc.on('close', (code) => {
      cleanupTempWav();
      if (code !== 0) {
        reject(new Error(`whisper.cppが異常終了しました (code ${code})\n${stderr.slice(-500)}`));
        return;
      }

      try {
        // whisper.cpp --output-json outputs to a .json file next to the audio
        // But with stdout, we try to parse the output
        // Actually, whisper.cpp writes JSON to <audioPath>.json
        const jsonPath = audioPath + '.json';
        let result;

        if (existsSync(jsonPath)) {
          result = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          // Clean up the json file
          try { fs.unlinkSync(jsonPath); } catch {}
        } else {
          // Try parsing stdout as JSON
          result = JSON.parse(stdout);
        }

        // Parse whisper.cpp JSON format
        const segments = [];
        const transcription = result.transcription || result.segments || [];

        for (const seg of transcription) {
          const text = (seg.text || '').trim();
          if (!text) continue;

          // whisper.cpp uses timestamps object or offsets
          const start = seg.timestamps?.from
            ? parseTimestamp(seg.timestamps.from)
            : (seg.start || seg.t0 || 0) / 100;
          const end = seg.timestamps?.to
            ? parseTimestamp(seg.timestamps.to)
            : (seg.end || seg.t1 || 0) / 100;

          segments.push({
            start: Math.round(start * 100) / 100,
            end: Math.round(end * 100) / 100,
            speaker: 'speaker_0',
            text,
          });
        }

        const detectedLang = result.result?.language || language;

        resolve({
          engine: 'whisper-cpp',
          language: detectedLang,
          segments,
          speakers: [{ id: 'speaker_0', label: 'speaker_0' }],
          raw_response: result,
        });
      } catch (parseErr) {
        // Fallback: parse text output line by line
        const lines = stdout.split('\n').filter(l => l.trim());
        const segments = [];
        const timeRegex = /\[(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)/;

        for (const line of lines) {
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

        if (segments.length > 0) {
          resolve({
            engine: 'whisper-cpp',
            language: language,
            segments,
            speakers: [{ id: 'speaker_0', label: 'speaker_0' }],
            raw_response: { text: stdout },
          });
        } else {
          reject(new Error(`whisper.cppの出力を解析できません:\n${stdout.slice(0, 500)}`));
        }
      }
    });
  });
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
