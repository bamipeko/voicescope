import OpenAI from 'openai';
import fs from 'fs';
import { isManagedMode } from '../managed.js';

export async function transcribeWithWhisper(audioPath, options = {}) {
  const { managed, workerBaseURL, token } = isManagedMode('openai');

  let openai;
  if (managed) {
    openai = new OpenAI({ apiKey: token, baseURL: `${workerBaseURL}/v1` });
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('文字起こし用のAPIキーが設定されていません。設定画面でOpenAIまたはDeepgramのキーを設定するか、トライアルコードを入力してください。');
    openai = new OpenAI({ apiKey });
  }

  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'whisper-1',
    language: options.language === 'auto' ? undefined : options.language,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  // Build segments from Whisper response (no speaker diarization)
  const segments = (response.segments || []).map(seg => ({
    start: seg.start,
    end: seg.end,
    speaker: 'speaker_0',
    text: seg.text.trim(),
  }));

  return {
    engine: 'whisper',
    language: response.language || options.language || 'unknown',
    segments,
    speakers: [{ id: 'speaker_0', label: 'speaker_0' }],
    raw_response: response,
  };
}
