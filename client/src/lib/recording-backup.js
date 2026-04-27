/**
 * Crash-resilient recording backup using IndexedDB.
 *
 * During recording, every MediaRecorder chunk is appended to IndexedDB in
 * addition to being held in memory. If the app is force-killed before
 * stop() runs, the session remains in the DB and can be recovered on next launch.
 *
 * Schema:
 *   DB: voicescape-recording-backup (v1)
 *   Store 'sessions' — keyPath: 'id'  { id, startedAt, mimeType, chunkCount, endedAt? }
 *   Store 'chunks'   — auto-increment, indexed by (sessionId, chunkIndex)
 *                      { sessionId, chunkIndex, blob, capturedAt }
 */

const DB_NAME = 'voicescape-recording-backup'
const DB_VERSION = 1
const STORE_SESSIONS = 'sessions'
const STORE_CHUNKS = 'chunks'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const store = db.createObjectStore(STORE_CHUNKS, { autoIncrement: true })
        store.createIndex('bySession', ['sessionId', 'chunkIndex'], { unique: false })
        store.createIndex('sessionId', 'sessionId', { unique: false })
      }
    }
  })
}

/**
 * Create a new backup session. Call at recording start.
 */
export async function createSession(mimeType) {
  const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const db = await openDB()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS], 'readwrite')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE_SESSIONS).put({
        id,
        startedAt: new Date().toISOString(),
        mimeType,
        chunkCount: 0,
        endedAt: null,
      })
    })
  } finally {
    db.close()
  }
  return id
}

/**
 * Append a chunk. Called from MediaRecorder.ondataavailable.
 */
export async function appendChunk(sessionId, chunkIndex, blob) {
  const db = await openDB()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_CHUNKS, STORE_SESSIONS], 'readwrite')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)

      tx.objectStore(STORE_CHUNKS).add({
        sessionId,
        chunkIndex,
        blob,
        capturedAt: Date.now(),
      })

      // Update chunkCount on the session record
      const sessReq = tx.objectStore(STORE_SESSIONS).get(sessionId)
      sessReq.onsuccess = () => {
        const s = sessReq.result
        if (s) {
          s.chunkCount = chunkIndex + 1
          tx.objectStore(STORE_SESSIONS).put(s)
        }
      }
    })
  } finally {
    db.close()
  }
}

/**
 * Mark session as finished. Removes chunks + session entry.
 * Call when stop() completes and the blob has been uploaded successfully.
 */
export async function finalizeSession(sessionId) {
  const db = await openDB()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_CHUNKS, STORE_SESSIONS], 'readwrite')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)

      // Delete all chunks for this session
      const idx = tx.objectStore(STORE_CHUNKS).index('sessionId')
      const cursorReq = idx.openCursor(IDBKeyRange.only(sessionId))
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }

      tx.objectStore(STORE_SESSIONS).delete(sessionId)
    })
  } finally {
    db.close()
  }
}

/**
 * List all orphaned sessions — ones that started but were never finalized.
 * Used at app startup to offer recovery.
 */
export async function listOrphanedSessions() {
  const db = await openDB()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS], 'readonly')
      const req = tx.objectStore(STORE_SESSIONS).getAll()
      req.onsuccess = () => resolve(req.result.filter(s => !s.endedAt))
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/**
 * Reconstruct a session's audio into a single Blob (in chunkIndex order).
 * Returns null if no chunks found.
 */
export async function reconstructSession(sessionId) {
  const db = await openDB()
  try {
    const [session, chunks] = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SESSIONS, STORE_CHUNKS], 'readonly')
      const sReq = tx.objectStore(STORE_SESSIONS).get(sessionId)
      const cReq = tx.objectStore(STORE_CHUNKS).index('sessionId').getAll(sessionId)
      tx.oncomplete = () => resolve([sReq.result, cReq.result])
      tx.onerror = () => reject(tx.error)
    })
    if (!session || !chunks || chunks.length === 0) return null

    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)
    const blobs = chunks.map(c => c.blob)
    const mimeType = session.mimeType || 'audio/webm'
    const combined = new Blob(blobs, { type: mimeType })
    return {
      sessionId,
      startedAt: session.startedAt,
      mimeType,
      blob: combined,
      chunkCount: chunks.length,
      durationEstimateSec: chunks.length, // MediaRecorder fires ~1/sec in our config
    }
  } finally {
    db.close()
  }
}

/**
 * Discard a session (delete without recovery).
 */
export async function discardSession(sessionId) {
  return finalizeSession(sessionId) // same effect — removes from DB
}
