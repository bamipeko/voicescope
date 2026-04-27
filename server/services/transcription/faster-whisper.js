import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryOne } from '../../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKER_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'faster_whisper_worker.py');

/**
 * Find the Python executable. Tries settings, then common names on PATH.
 */
function getPythonPath() {
  const setting = queryOne("SELECT value FROM settings WHERE key = 'local_whisper_python_path'");
  if (setting) {
    try {
      return JSON.parse(setting.value);
    } catch {
      return setting.value;
    }
  }
  // On Windows, try 'python' first (Python 3 launcher), then 'python3'
  return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Run the Python worker as a subprocess and collect JSON output.
 */
function runPythonWorker(args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonPath();
    const proc = spawn(pythonPath, [WORKER_SCRIPT, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[faster-whisper] ${msg}`);
      stderr += msg + '\n';
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`Pythonが見つかりません (${pythonPath})。Pythonをインストールしてください。`));
      } else {
        reject(new Error(`Python実行エラー: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        // Try to parse error from stdout
        try {
          const result = JSON.parse(stdout);
          if (result.error) {
            reject(new Error(result.error));
            return;
          }
        } catch {}
        reject(new Error(`faster-whisperが異常終了しました (code ${code})\n${stderr.slice(-500)}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch {
        reject(new Error(`faster-whisperの出力を解析できません: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

/**
 * Check if faster-whisper is available.
 */
export async function checkFasterWhisper() {
  try {
    const result = await runPythonWorker(['--check'], 15000);
    return result;
  } catch {
    return { available: false, version: null, gpu: false };
  }
}

/**
 * Transcribe audio using faster-whisper (local).
 * Returns the same format as deepgram.js and whisper.js.
 */
export async function transcribeWithFasterWhisper(audioPath, options = {}) {
  const modelSetting = queryOne("SELECT value FROM settings WHERE key = 'local_whisper_model'");
  const modelSize = modelSetting ? JSON.parse(modelSetting.value) : 'base';

  const language = (!options.language || options.language === 'auto') ? 'auto' : options.language;

  const args = ['--audio', audioPath, '--model', modelSize];
  if (language !== 'auto') {
    args.push('--language', language);
  }

  console.log(`[faster-whisper] Transcribing: model=${modelSize}, language=${language}`);
  const result = await runPythonWorker(args);

  if (result.error) {
    throw new Error(result.error);
  }

  // Map to standard segment format
  // faster-whisper doesn't do speaker diarization, so all segments are speaker_0
  const segments = (result.segments || []).map(seg => ({
    start: seg.start,
    end: seg.end,
    speaker: 'speaker_0',
    text: seg.text,
  }));

  return {
    engine: 'faster-whisper',
    language: result.language || options.language || 'unknown',
    segments,
    speakers: [{ id: 'speaker_0', label: 'speaker_0' }],
    raw_response: result,
  };
}
