import { transcribeWithDeepgram } from './deepgram.js';
import { transcribeWithWhisper } from './whisper.js';
import { queryOne } from '../../db/database.js';

const engines = {
  deepgram: transcribeWithDeepgram,
  whisper: transcribeWithWhisper,
};

export async function transcribe(audioPath, options = {}) {
  // Determine engine: explicit > settings default
  let engine = options.engine;
  if (!engine) {
    const setting = queryOne("SELECT value FROM settings WHERE key = 'default_transcription_engine'");
    engine = setting ? JSON.parse(setting.value) : 'deepgram';
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

  return transcribeFn(audioPath, options);
}
