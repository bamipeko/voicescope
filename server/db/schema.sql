-- VoiceScope Database Schema

-- Recordings
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  title TEXT,
  file_path TEXT NOT NULL,
  duration_sec INTEGER,
  recorded_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'uploaded'
);

-- Transcriptions
CREATE TABLE IF NOT EXISTS transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  language TEXT,
  segments_json TEXT NOT NULL,
  speakers_json TEXT,
  raw_response_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Summaries
CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES templates(id),
  llm_provider TEXT NOT NULL,
  llm_model TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Templates
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  output_format TEXT,
  is_default INTEGER DEFAULT 0,
  preferred_llm_provider TEXT,
  preferred_llm_model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#6B7280'
);

-- Recording-Tag junction
CREATE TABLE IF NOT EXISTS recording_tags (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT DEFAULT 'manual',
  PRIMARY KEY (recording_id, tag_id)
);

-- Known speakers
CREATE TABLE IF NOT EXISTS known_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transcriptions_recording ON transcriptions(recording_id);
CREATE INDEX IF NOT EXISTS idx_summaries_recording ON summaries(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_tags_recording ON recording_tags(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_tags_tag ON recording_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_recorded_at ON recordings(recorded_at);
