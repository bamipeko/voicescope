import { transcribeWithDeepgram } from './deepgram.js';
import { transcribeWithWhisper } from './whisper.js';
import { transcribeWithFasterWhisper } from './faster-whisper.js';
import { transcribeWithWhisperCpp, isWhisperCppInstalled } from './whisper-cpp.js';
import { transcribeWithGrokSTT } from './grok.js';
import { queryOne } from '../../db/database.js';
import { getProcessingMode } from '../processing-mode.js';

const engines = {
  deepgram: transcribeWithDeepgram,
  whisper: transcribeWithWhisper,
  'faster-whisper': transcribeWithFasterWhisper,
  'whisper-cpp': transcribeWithWhisperCpp,
  'grok-stt': transcribeWithGrokSTT,
};

export async function transcribe(audioPath, options = {}) {
  const processingMode = getProcessingMode();

  // Determine engine: explicit > settings default
  let engine = options.engine;
  if (!engine) {
    const setting = queryOne("SELECT value FROM settings WHERE key = 'default_transcription_engine'");
    engine = setting ? JSON.parse(setting.value) : 'deepgram';
  }

  // OFFLINE MODE: force local engines only
  if (processingMode === 'offline') {
    if (engine !== 'whisper-cpp' && engine !== 'faster-whisper') {
      if (isWhisperCppInstalled()) {
        console.log('[Transcription] Offline mode: forcing whisper-cpp');
        engine = 'whisper-cpp';
      } else {
        throw new Error('オフラインモードが有効ですが、whisper.cpp がインストールされていません。設定画面からセットアップしてください。');
      }
    }
  } else {
    // Cloud modes: auto-fallback based on available keys.
    // Engine requirements:
    //   deepgram → DEEPGRAM_API_KEY
    //   whisper  → OPENAI_API_KEY
    //   grok-stt → GROK_API_KEY
    const canUse = {
      deepgram: !!process.env.DEEPGRAM_API_KEY,
      whisper: !!process.env.OPENAI_API_KEY,
      'grok-stt': !!process.env.GROK_API_KEY,
    };
    if (canUse[engine] === false) {
      // Pick any available cloud engine in priority order
      const preferredOrder = ['deepgram', 'grok-stt', 'whisper'];
      const fallback = preferredOrder.find((e) => canUse[e]);
      if (fallback) {
        console.log(`[Transcription] ${engine} key missing, falling back to ${fallback}`);
        engine = fallback;
      }
      // If no cloud engine is available, transcribeFn will throw below with a helpful message
    }
  }

  const transcribeFn = engines[engine];
  if (!transcribeFn) {
    throw new Error(`Unknown transcription engine: ${engine}. Available: ${Object.keys(engines).join(', ')}`);
  }

  // Get language setting
  if (!options.language) {
    const langSetting = queryOne("SELECT value FROM settings WHERE key = 'default_language'");
    options.language = langSetting ? JSON.parse(langSetting.value) : 'auto';
  }

  // Get diarization setting
  if (options.diarize === undefined) {
    const diarSetting = queryOne("SELECT value FROM settings WHERE key = 'diarization_enabled'");
    options.diarize = diarSetting ? JSON.parse(diarSetting.value) === 'true' || diarSetting.value === 'true' : true;
  }

  // Get custom keywords (for Deepgram)
  if (!options.keywords) {
    const kwSetting = queryOne("SELECT value FROM settings WHERE key = 'custom_keywords'");
    if (kwSetting) {
      const raw = JSON.parse(kwSetting.value);
      const words = raw.split('\n').map(w => w.trim()).filter(Boolean);
      if (words.length > 0) options.keywords = words;
    }
  }

  return transcribeFn(audioPath, options);
}
