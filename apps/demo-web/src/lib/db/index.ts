import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import { paths } from '../paths';

export interface TaskRecord {
  id: string;
  session_id: string;
  is_sample: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  original_filename: string;
  file_path: string;
  options_json: string;
  output_path: string | null;
  result_path: string | null;
  processed_result_path: string | null;
  total_pages: number | null;
  chapters_count: number | null;
  images_count: number | null;
  tables_count: number | null;
  token_usage_json: string | null;
  current_step: string | null;
  progress_percent: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  // Webhook-related fields
  client_ip: string | null;
  user_agent: string | null;
  // OTP bypass tracking
  is_otp_bypass: boolean;
}

export interface TaskLogRecord {
  id: number;
  task_id: string;
  level: string;
  message: string;
  timestamp: string;
}

export interface OTPLockoutRecord {
  identifier: string;
  failed_attempts: number;
  first_failed_at: string;
  is_permanently_locked: boolean;
  locked_at: string | null;
}

export interface UploadSessionRecord {
  id: string; // upload_xxx
  session_id: string;
  filename: string;
  file_size: number;
  total_chunks: number;
  received_chunks: string; // JSON: number[]
  chunk_dir: string;
  client_ip: string;
  is_otp_bypass: boolean;
  options_json: string; // Processing options
  status: 'uploading' | 'completed' | 'expired' | 'cancelled';
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

interface Database {
  tasks: TaskRecord[];
  logs: TaskLogRecord[];
  nextLogId: number;
  otpLockouts: OTPLockoutRecord[];
  uploadSessions: UploadSessionRecord[];
}

const DB_PATH = paths.database.replace('.db', '.json');

function ensureDbExists(): void {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(DB_PATH)) {
    const initialDb: Database = {
      tasks: [],
      logs: [],
      nextLogId: 1,
      otpLockouts: [],
      uploadSessions: [],
    };
    writeFileSync(DB_PATH, JSON.stringify(initialDb, null, 2));
  }
}

export function readDatabase(): Database {
  ensureDbExists();
  const content = readFileSync(DB_PATH, 'utf-8');
  const db = JSON.parse(content) as Database;

  // Migration: ensure otpLockouts exists
  if (!db.otpLockouts) {
    db.otpLockouts = [];
  }

  // Migration: ensure uploadSessions exists
  if (!db.uploadSessions) {
    db.uploadSessions = [];
  }

  // Migration: add session_id to existing tasks and convert legacy to sample
  let needsWrite = false;
  for (const task of db.tasks) {
    if ((task as { session_id?: string }).session_id === undefined) {
      (task as TaskRecord).session_id = 'legacy';
      needsWrite = true;
    }
    // Migration: convert legacy session tasks to sample
    if ((task as { is_sample?: boolean }).is_sample === undefined) {
      (task as TaskRecord).is_sample = task.session_id === 'legacy';
      needsWrite = true;
    }
    // Migration: add is_otp_bypass to existing tasks
    if ((task as { is_otp_bypass?: boolean }).is_otp_bypass === undefined) {
      (task as TaskRecord).is_otp_bypass = false;
      needsWrite = true;
    }
  }
  if (needsWrite) {
    writeDatabase(db);
  }

  return db;
}

export function writeDatabase(db: Database): void {
  ensureDbExists();
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
