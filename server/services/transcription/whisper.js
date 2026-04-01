import OpenAI from 'openai';
import fs from 'fs';

export async function transcribeWithWhisper(audioPath, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません');
  }

  const openai = new OpenAI({ apiKey });

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
