import path from 'path';
import { execute, queryOne, queryAll, lastInsertRowId } from '../db/database.js';
import { transcribe } from './transcription/index.js';
import { summarize } from './summary/index.js';
import { suggestTags } from './tagging.js';
import { refineTranscription } from './refine.js';
import { getAudioDuration } from '../utils/audio.js';
import { getProcessingMode } from './processing-mode.js';
import { getAudioDir } from '../utils/platform-paths.js';

const AUDIO_DIR = getAudioDir();

/**
 * Generate a short descriptive title from transcription text using LLM.
 */
async function generateTitle(transcriptionText) {
  const titlePrompt = 'あなたはタイトル生成AIです。以下の文字起こしテキストの内容を一言で表す短い日本語タイトル（15〜30文字程度）を生成してください。タイトルのみを返してください。装飾や括弧は不要です。';

  // Use askLLM which supports all providers including Ollama
  const { askLLM } = await import('./ask.js');
  const title = await askLLM(transcriptionText, titlePrompt);
  // Clean up — remove quotes, newlines, markdown, etc.
  return title.replace(/^["'「」『』#*\s]+|["'「」『』#*\s]+$/g, '').replace(/\n/g, '').trim();
}

// Event listeners for pipeline progress
const listeners = new Map();

export function onPipelineProgress(recordingId, callback) {
  listeners.set(recordingId, callback);
}

function notify(recordingId, status, data = {}) {
  const cb = listeners.get(recordingId);
  if (cb) cb({ status, ...data });
}

/**
 * @param {string} recordingId
 * @param {object} options
 * @param {boolean} options.skipTranscription — Skip transcription (for text uploads)
 * @param {boolean} options.skipSummary — Skip summary generation
 * @param {string}  options.templateId — Template for summary
 * @param {string}  options.granularity — Summary granularity (brief/normal/detailed)
 */
export async function runPipeline(recordingId, options = {}) {
  const recording = queryOne('SELECT * FROM recordings WHERE id = ?', [recordingId]);
  if (!recording) throw new Error('Recording not found');

  const audioPath = path.join(AUDIO_DIR, recording.file_path);
  const processingMode = getProcessingMode();

  // Track whether each step ran locally. processed_locally is set at the END
  // only if BOTH transcription and summary ran locally.
  let transcriptionLocal = false;
  let summaryLocal = false;

  try {

    // Step 1: Get audio duration (skip for text uploads)
    if (!options.skipTranscription) {
      const duration = await getAudioDuration(audioPath);
      if (duration) {
        execute('UPDATE recordings SET duration_sec = ? WHERE id = ?', [duration, recordingId]);
      }
    }

    // Step 2: Transcription (skip for text uploads — already provided)
    if (options.skipTranscription) {
      console.log(`[Pipeline] Skipping transcription for ${recordingId} (text upload)`);
      // Text upload: treat as local if no external service was used during upload parsing
      // (parsing LLM only runs for unknown formats — conservatively mark as NOT local if LLM was used)
      transcriptionLocal = !options.parsedByLLM;
    } else {
      // Do transcription
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['transcribing', recordingId]);
      notify(recordingId, 'transcribing');

      const transcriptionResult = await transcribe(audioPath);

      // Track whether the transcription engine was local
      transcriptionLocal = ['whisper-cpp', 'faster-whisper'].includes(transcriptionResult.engine);

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
    } // end of if/else skipTranscription

    // Step 2.5: Auto-refine transcription — runs IN PARALLEL with summary.
    //
    // Rationale: the user sees "整形中..." stuck for ages because refine and
    // summary used to run serially and the UI only polls every few seconds.
    // Now:
    //   1. Kick off refine as a background promise.
    //   2. Give it a short head-start (up to REFINE_HEAD_START_MS) so the
    //      summary can still benefit from the refined text for fast refines.
    //   3. Start summary after that window regardless — they run in parallel.
    //   4. The refined segments are written to the transcriptions table the
    //      moment refine finishes, so the UI can surface them immediately
    //      (independent of summary status).
    const REFINE_HEAD_START_MS = 3000;
    const autoRefine = queryOne("SELECT value FROM settings WHERE key = 'auto_refine_transcription'");
    const shouldRefine = !options.skipRefine && (autoRefine ? JSON.parse(autoRefine.value) !== false : true);

    let refinePromise = Promise.resolve(null);
    if (shouldRefine) {
      const transRow = queryOne(
        'SELECT id FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
        [recordingId]
      );
      if (transRow) {
        execute('UPDATE recordings SET status = ? WHERE id = ?', ['refining', recordingId]);
        notify(recordingId, 'refining');
        refinePromise = refineTranscription(transRow.id)
          .then((result) => {
            // Persist warnings so the UI can toast them. Handled in both
            // the head-start await below AND the final await at the end
            // (whichever resolves first gets to write — the second is a no-op).
            if (result?.fallback) {
              const warning = {
                type: 'fallback',
                primary: result.fallback.primary,
                fallback: result.fallback.fallback,
                reason: result.fallback.reason,
                at: new Date().toISOString(),
                acknowledged: 0,
              };
              execute('UPDATE recordings SET refine_warning = ? WHERE id = ?', [JSON.stringify(warning), recordingId]);
              notify(recordingId, 'refine-fallback', warning);
            } else if (result && result.refined === false && result.reason === 'primary-failed-no-fallback') {
              const warning = {
                type: 'failed',
                primary: result.primary,
                reason: result.error,
                at: new Date().toISOString(),
                acknowledged: 0,
              };
              execute('UPDATE recordings SET refine_warning = ? WHERE id = ?', [JSON.stringify(warning), recordingId]);
              notify(recordingId, 'refine-failed', warning);
            }
            // Nudge the UI: refine is done; if summary hasn't claimed the
            // status yet, clients will see a transient 'refined' in their
            // next poll and can switch to the refined transcript view.
            notify(recordingId, 'refined');
            return result;
          })
          .catch((err) => {
            console.warn(`[Pipeline] Refinement failed for ${recordingId}:`, err.message);
            return null;
          });
      }
    }

    // Give refine a head-start (resolves early if refine finishes first).
    if (shouldRefine) {
      await Promise.race([
        refinePromise,
        new Promise((resolve) => setTimeout(resolve, REFINE_HEAD_START_MS)),
      ]);
    }

    // Build fullText for summary using whatever is in the transcription table
    // right now (refined if the head-start was long enough, original otherwise).
    // We read from DB here — works for both audio uploads and text uploads,
    // and doesn't depend on transcriptionResult being in scope (the text-upload
    // path skips the transcribe() call so that local is never assigned).
    const latestTrans = queryOne(
      'SELECT * FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
      [recordingId]
    );
    let summarySegments = [];
    if (latestTrans?.refined_segments_json) {
      try {
        summarySegments = JSON.parse(latestTrans.refined_segments_json);
      } catch (e) {
        // Refined JSON malformed — fall through to original segments below
      }
    }
    if (summarySegments.length === 0 && latestTrans?.segments_json) {
      try {
        summarySegments = JSON.parse(latestTrans.segments_json);
      } catch (e) {
        summarySegments = [];
      }
    }
    const fullText = summarySegments
      .map(s => `${s.speaker || ''}: ${s.text || ''}`)
      .join('\n');

    if (!fullText.trim()) {
      // Still wait for refine to finish before declaring done, so we don't
      // drop an in-flight refine write.
      await refinePromise.catch(() => null);
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['completed', recordingId]);
      notify(recordingId, 'completed');
      return;
    }

    // Step 3: Summary (runs in parallel with any still-in-flight refine).
    if (options.skipSummary) {
      console.log(`[Pipeline] Skipping summary for ${recordingId}`);
      await refinePromise.catch(() => null);
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['completed', recordingId]);
      notify(recordingId, 'completed');
    } else {
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['summarizing', recordingId]);
      notify(recordingId, 'summarizing');

      const summaryOpts = {};
      if (options.templateId) summaryOpts.templateId = options.templateId;
      if (options.granularity) summaryOpts.granularity = options.granularity;
      if (options.provider) summaryOpts.provider = options.provider;
      if (options.model) summaryOpts.model = options.model;

      const summaryResult = await summarize(fullText, summaryOpts);

      // Track whether the summary ran locally (Ollama)
      summaryLocal = ['ollama', 'custom'].includes(summaryResult.provider);

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

      // Make sure refine has landed (in case summary finished first)
      await refinePromise.catch(() => null);

      // Done
      execute('UPDATE recordings SET status = ? WHERE id = ?', ['completed', recordingId]);
      notify(recordingId, 'completed');
    }

    // Auto-generate title from transcription content (runs for both audio + text uploads)
    const updated = queryOne('SELECT title, original_filename FROM recordings WHERE id = ?', [recordingId]);
    // Regenerate title if empty, or if current title matches the original filename
    // (text uploads initially set title = filename; we want to replace with content-based title)
    const shouldGenerateTitle = !updated.title
      || (updated.original_filename && updated.title === updated.original_filename.replace(/\.[^.]+$/, ''));

    if (shouldGenerateTitle) {
      try {
        const titleText = fullText.slice(0, 500);
        const autoTitle = await generateTitle(titleText);
        if (autoTitle) {
          execute('UPDATE recordings SET title = ? WHERE id = ?', [autoTitle.slice(0, 80), recordingId]);
        }
      } catch (titleErr) {
        console.error('Auto-title generation failed (non-fatal):', titleErr.message);
        // Fallback: use first segment text
        const firstSegment = summarySegments[0]?.text || '';
        const fallbackTitle = firstSegment.slice(0, 50) + (firstSegment.length > 50 ? '...' : '');
        if (fallbackTitle) {
          execute('UPDATE recordings SET title = ? WHERE id = ?', [fallbackTitle, recordingId]);
        }
      }
    }

    // Finalize processed_locally: true only if BOTH transcription and summary ran locally
    // (if summary was skipped, only consider transcription)
    const isFullyLocal = options.skipSummary
      ? transcriptionLocal
      : (transcriptionLocal && summaryLocal);
    execute(
      'UPDATE recordings SET processed_locally = ? WHERE id = ?',
      [isFullyLocal ? 1 : 0, recordingId]
    );

  } catch (err) {
    console.error(`Pipeline error for ${recordingId}:`, err);
    // Store error message in title if no title set, for debugging
    const rec = queryOne('SELECT title FROM recordings WHERE id = ?', [recordingId]);
    if (!rec?.title) {
      execute('UPDATE recordings SET title = ? WHERE id = ?', [`[Error] ${err.message}`.slice(0, 200), recordingId]);
    }
    execute('UPDATE recordings SET status = ? WHERE id = ?', ['error', recordingId]);
    notify(recordingId, 'error', { error: err.message });
    throw err;
  } finally {
    listeners.delete(recordingId);
  }
}
