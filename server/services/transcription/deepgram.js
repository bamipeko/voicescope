import { createClient } from '@deepgram/sdk';
import fs from 'fs';
import { isManagedMode } from '../managed.js';

export async function transcribeWithDeepgram(audioPath, options = {}) {
  const audioBuffer = fs.readFileSync(audioPath);
  const language = (!options.language || options.language === 'auto') ? 'ja' : options.language;

  const { managed, workerBaseURL, token } = isManagedMode('deepgram');

  let result;

  if (managed) {
    // Managed mode: send audio to Worker proxy
    const params = new URLSearchParams({
      model: 'nova-2',
      language,
      smart_format: 'true',
      diarize: options.diarize !== false ? 'true' : 'false',
      punctuate: 'true',
      utterances: 'true',
    });

    const resp = await fetch(`${workerBaseURL}/v1/transcribe?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'audio/webm',
      },
      body: audioBuffer,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Deepgram proxy error: ${err.error || resp.statusText}`);
    }

    result = await resp.json();
  } else {
    // Direct mode: use Deepgram SDK
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('文字起こし用のAPIキーが設定されていません。設定画面でOpenAIまたはDeepgramのキーを設定するか、トライアルコードを入力してください。');

    const deepgram = createClient(apiKey);

    const dgOptions = {
      model: 'nova-2',
      language,
      smart_format: true,
      diarize: options.diarize !== false,
      punctuate: true,
      utterances: true,
    };

    if (options.keywords?.length > 0) {
      dgOptions.keywords = options.keywords.map(w => `${w}:2`);
    }

    const dgResult = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, dgOptions);
    if (dgResult.error) throw new Error(`Deepgram API error: ${dgResult.error.message}`);
    result = dgResult.result;
  }

  const channel = result.results?.channels?.[0];
  const alternatives = channel?.alternatives?.[0];

  if (!alternatives) {
    throw new Error('Deepgram returned no transcription results');
  }

  // Build segments from word-level data for fine-grained timestamps.
  // Deepgram's paragraphs.sentences can produce very long segments for Japanese,
  // so we use words directly and split by speaker change, pauses, or max duration.
  const segments = [];
  const speakerSet = new Set();

  const MAX_SEGMENT_SEC = 20; // Split segments longer than 20 seconds
  const PAUSE_THRESHOLD = 1.5; // Split on pauses > 1.5 seconds

  if (alternatives.words?.length > 0) {
    let current = null;
    for (const word of alternatives.words) {
      const speakerId = `speaker_${word.speaker ?? 0}`;
      const wordText = word.punctuated_word || word.word;
      speakerSet.add(speakerId);

      const shouldSplit = !current
        || current.speaker !== speakerId
        || (word.start - current.end) > PAUSE_THRESHOLD
        || (word.start - current.start) > MAX_SEGMENT_SEC;

      if (shouldSplit) {
        if (current) segments.push(current);
        current = { start: word.start, end: word.end, speaker: speakerId, text: wordText };
      } else {
        current.end = word.end;
        current.text += ' ' + wordText;
      }
    }
    if (current) segments.push(current);
  } else if (alternatives.paragraphs?.paragraphs) {
    // Fallback to paragraphs if no word data
    for (const para of alternatives.paragraphs.paragraphs) {
      for (const sentence of para.sentences) {
        const speakerId = `speaker_${para.speaker}`;
        speakerSet.add(speakerId);
        segments.push({
          start: sentence.start,
          end: sentence.end,
          speaker: speakerId,
          text: sentence.text,
        });
      }
    }
  }

  const speakers = Array.from(speakerSet).map(id => ({ id, label: id }));
  const detectedLanguage = channel?.detected_language || result.results?.channels?.[0]?.detected_language || options.language || 'unknown';

  return {
    engine: 'deepgram',
    language: detectedLanguage,
    segments,
    speakers,
    raw_response: result,
  };
}
