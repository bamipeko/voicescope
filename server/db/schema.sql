-- VoiceScope Database Schema

-- Recordings
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  title TEXT,
  file_path TEXT NOT NULL,
  duration_sec INTEGER,
  recorded_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'uploaded',
  importance INTEGER DEFAULT 1,
  processed_locally INTEGER DEFAULT 0,
  summary_segment_ids_json TEXT,
  original_filename TEXT
);

-- Transcriptions
CREATE TABLE IF NOT EXISTS transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  engine TEXT NOT NULL,
  language TEXT,
  segments_json TEXT NOT NULL,
  refined_segments_json TEXT,
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
  custom_prompt TEXT,
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
  sort_order INTEGER DEFAULT 0,
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

-- Highlights (timestamp marks during recording)
CREATE TABLE IF NOT EXISTS highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  timestamp_sec REAL NOT NULL,
  label TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Known speakers
CREATE TABLE IF NOT EXISTS known_speakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '📁',
  sort_order INTEGER DEFAULT 0,
  auto_tag_ids TEXT DEFAULT '',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Recording-Folder junction
CREATE TABLE IF NOT EXISTS recording_folders (
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, folder_id)
);

CREATE INDEX IF NOT EXISTS idx_recording_folders_recording ON recording_folders(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_folders_folder ON recording_folders(folder_id);

-- AI chat history
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_recording ON chat_messages(recording_id);

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
CREATE INDEX IF NOT EXISTS idx_highlights_recording ON highlights(recording_id);
