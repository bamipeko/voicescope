import fs from 'fs';
import path from 'path';
import { queryAll, queryOne, execute } from '../db/database.js';
import { getAudioDir } from '../utils/platform-paths.js';

const AUDIO_DIR = getAudioDir();

/**
 * Safely resolve an audio path for deletion — refuses anything escaping AUDIO_DIR
 * (directory traversal protection; file_path is usually just the uuid+ext, but
 * users with older DBs may have relative paths).
 */
function safeAudioPath(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(AUDIO_DIR, filePath);
  if (!resolved.startsWith(path.resolve(AUDIO_DIR))) return null;
  return resolved;
}

function readSetting(key, fallback) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value ?? fallback; }
}

/**
 * Delete trashed recordings that have been in the trash longer than
 * `trash_retention_days`. Respects `trash_delete_mode`:
 *   - 'complete'   → full DB + audio deletion (default)
 *   - 'audio_only' → keep metadata, transcriptions, summaries; erase audio
 *
 * Runs on server startup AND every 6 hours afterwards. Idempotent and cheap
 * enough that running it multiple times is fine.
 */
export function runTrashCleanup() {
  const retentionDays = Math.max(1, Math.min(30, Number(readSetting('trash_retention_days', 14)) || 14));
  const mode = readSetting('trash_delete_mode', 'complete');

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const expired = queryAll(
    'SELECT id, file_path FROM recordings WHERE trashed_at IS NOT NULL AND trashed_at <= ?',
    [cutoff]
  );

  if (expired.length === 0) {
    console.log(`[TrashCleanup] No expired trash items (retention=${retentionDays}d, mode=${mode})`);
    return { deleted: 0, mode, retentionDays };
  }

  console.log(`[TrashCleanup] Purging ${expired.length} item(s) past ${retentionDays}d (mode=${mode})`);

  for (const rec of expired) {
    try {
      // Always remove the audio file regardless of mode
      const audioPath = safeAudioPath(rec.file_path);
      if (audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
      }

      if (mode === 'complete') {
        // Delete the recording row; CASCADE removes transcriptions/summaries/tags/etc.
        execute('DELETE FROM recordings WHERE id = ?', [rec.id]);
      } else {
        // audio_only mode — null out the file_path so the UI knows audio is gone,
        // keep the row for the transcript/summary to remain readable.
        // We also flip trashed_at → NULL and set archived_at = now so the record
        // moves out of trash (preventing re-processing on the next cleanup pass).
        execute(
          `UPDATE recordings
             SET file_path = '',
                 trashed_at = NULL,
                 archived_at = COALESCE(archived_at, ?),
                 duration_sec = 0
           WHERE id = ?`,
          [new Date().toISOString(), rec.id]
        );
      }
    } catch (err) {
      console.error(`[TrashCleanup] Failed to process ${rec.id}:`, err.message);
    }
  }

  return { deleted: expired.length, mode, retentionDays };
}

/**
 * Schedule periodic cleanup. Called once from server startup.
 * Runs immediately, then every 6 hours.
 */
export function startTrashCleanupScheduler() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  try { runTrashCleanup(); } catch (e) { console.error('[TrashCleanup] Startup run failed:', e.message); }
  const timer = setInterval(() => {
    try { runTrashCleanup(); } catch (e) { console.error('[TrashCleanup] Periodic run failed:', e.message); }
  }, SIX_HOURS);
  timer.unref?.(); // don't block process exit
}
