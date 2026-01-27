-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued',
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  options_json TEXT NOT NULL,
  output_path TEXT,
  result_path TEXT,
  processed_result_path TEXT,
  total_pages INTEGER,
  chapters_count INTEGER,
  images_count INTEGER,
  tables_count INTEGER,
  token_usage_json TEXT,
  current_step TEXT,
  progress_percent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT
);

-- Task logs table
CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id);
