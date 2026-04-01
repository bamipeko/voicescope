import path from 'path';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { transcribe } from './transcription/index.js';
import { summarize } from './summary/index.js';
import { suggestTags } from './tagging.js';
import { getAudioDuration } from '../utils/audio.js';

const DATA_DIR = process.env.DATA_DIR || './data';
const AUDIO_DIR = path.resolve(DATA_DIR, 'audio');

// Event listeners for pipeline progress
const listeners = new Map();

export function onPipelineProgress(recordingId, callback) {
  listeners.set(recordingId, callback);
}

function notify(recordingId, status, data = {}) {
  const cb = listeners.get(recordingId);
  if (cb) cb({ status, ...data });
}

export async function runPipeline(recordingId) {
  const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [recordingId]);
  if (!recording) throw new Error('Recording not found');

  const audioPath = path.join(AUDIO_DIR, recording.file_path);

  try {
    // Step 1: Get audio duration
    const duration = await getAudioDuration(audioPath);
    if (duration) {
      execute('UPDATE recordings SET duration_sec = ? WHERE id = ?', [duration, recordingId]);
    }

    // Step 2: Transcription
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['transcribing', recordingId]);
    notify(recordingId, 'transcribing');

    const transcriptionResult = await transcribe(audioPath);

    execute(
      `INSERT INTO transcriptions (recording_id, engine, language, segments_json, speakers_json, raw_response_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        recordingId,
        transcriptionResult.engine,
        transcriptionResult.language,
        JSON.stringify(transcriptionResult.segments),
        JSON.stringify(transcriptionResult.speakers),
        JSON.stringify(transcriptionResult.raw_response),
      ]
    );

    execute('UPDATE recordings SET status = ? WHERE id = ?', ['transcribed', recordingId]);
    notify(recordingId, 'transcribed');

    // Build full text for summary
    const fullText = transcriptionResult.segments
      .map(s => `${s.speaker}: ${s.text}`)
      .join('\n');

    if (!fullText.trim()) {
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['completed', recordingId]);
      notify(recordingId, 'completed');
      return;
    }

    // Step 3: Summary
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['summarizing', recordingId]);
    notify(recordingId, 'summarizing');

    const summaryResult = await summarize(fullText);

    execute(
      `INSERT INTO summaries (recording_id, template_id, llm_provider, llm_model, content)
       VALUES (?, ?, ?, ?, ?)`,
      [recordingId, summaryResult.templateId, summaryResult.provider, summaryResult.model, summaryResult.content]
    );

    // Step 4: Auto-tag
    try {
      const tags = await suggestTags(fullText);
      for (const tagName of tags) {
        if (!tagName || typeof tagName !== 'string') continue;
        const trimmed = tagName.trim();
        if (!trimmed) continue;

        let tag = queryOne('SELECT * FROM tags WHERE name = ?', [trimmed]);
        if (!tag) {
          execute('INSERT INTO tags (name) VALUES (?)', [trimmed]);
          const tagId = lastInsertRowId();
          tag = { id: tagId };
        }

        const existing = queryOne(
          'SELECT * FROM recording_tags WHERE recording_id = ? AND tag_id = ?',
          [recordingId, tag.id]
        );
        if (!existing) {
          execute(
            'INSERT INTO recording_tags (recording_id, tag_id, source) VALUES (?, ?, ?)',
            [recordingId, tag.id, 'auto']
          );
        }
      }
    } catch (tagErr) {
      console.error('Auto-tagging failed (non-fatal):', tagErr.message);
    }

    // Done
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['completed', recordingId]);
    notify(recordingId, 'completed');

    // Auto-generate title if not set
    const updated = queryOne('SELECT title FROM recordings WHERE id = ?', [recordingId]);
    if (!updated.title) {
      const firstSegment = transcriptionResult.segments[0]?.text || '';
      const autoTitle = firstSegment.slice(0, 50) + (firstSegment.length > 50 ? '...' : '');
      if (autoTitle) {
        execute('UPDATE recordings SET title = ? WHERE id = ?', [autoTitle, recordingId]);
      }
    }

  } catch (err) {
    console.error(`Pipeline error for ${recordingId}:`, err);
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['error', recordingId]);
    notify(recordingId, 'error', { error: err.message });
    throw err;
  } finally {
    listeners.delete(recordingId);
  }
}
