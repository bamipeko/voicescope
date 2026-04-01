import { createClient } from '@deepgram/sdk';
import fs from 'fs';

export async function transcribeWithDeepgram(audioPath, options = {}) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY が設定されていません');
  }

  const deepgram = createClient(apiKey);
  const audioBuffer = fs.readFileSync(audioPath);

  // When language is 'auto', default to 'ja' instead of using detect_language
  // because detect_language is not available on all Deepgram plans
  const language = (!options.language || options.language === 'auto') ? 'ja' : options.language;

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model: 'nova-2',
      language,
      smart_format: true,
      diarize: options.diarize !== false,
      punctuate: true,
      utterances: true,
    }
  );

  if (error) {
    throw new Error(`Deepgram API error: ${error.message}`);
  }

  const channel = result.results?.channels?.[0];
  const alternatives = channel?.alternatives?.[0];

  if (!alternatives) {
    throw new Error('Deepgram returned no transcription results');
  }

  // Build segments from utterances (includes speaker info)
  const segments = [];
  const speakerSet = new Set();

  if (alternatives.paragraphs?.paragraphs) {
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
  } else if (alternatives.words) {
    // Fallback: group words into segments by speaker
    let current = null;
    for (const word of alternatives.words) {
      const speakerId = `speaker_${word.speaker || 0}`;
      speakerSet.add(speakerId);
      if (!current || current.speaker !== speakerId) {
        if (current) segments.push(current);
        current = { start: word.start, end: word.end, speaker: speakerId, text: word.punctuated_word || word.word };
      } else {
        current.end = word.end;
        current.text += ' ' + (word.punctuated_word || word.word);
      }
    }
    if (current) segments.push(current);
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
