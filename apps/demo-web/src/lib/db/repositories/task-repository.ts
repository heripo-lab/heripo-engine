import type { TaskRecord } from '../index';

import { sampleTaskConfig } from '~/lib/config/public-mode';

import type { ProcessingOptions } from '~/features/upload';

import { readDatabase, writeDatabase } from '../index';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  sessionId: string;
  isSample: boolean;
  status: TaskStatus;
  originalFilename: string;
  filePath: string;
  options: ProcessingOptions;
  outputPath: string | null;
  resultPath: string | null;
  processedResultPath: string | null;
  totalPages: number | null;
  chaptersCount: number | null;
  imagesCount: number | null;
  tablesCount: number | null;
  tokenUsage: unknown | null;
  currentStep: string | null;
  progressPercent: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  // Webhook-related fields
  clientIp: string | null;
  userAgent: string | null;
  // OTP bypass tracking
  isOtpBypass: boolean;
}

function recordToTask(row: TaskRecord): Task {
  return {
    id: row.id,
    sessionId: row.session_id,
    isSample: row.is_sample,
    status: row.status,
    originalFilename: row.original_filename,
    filePath: row.file_path,
    options: JSON.parse(row.options_json) as ProcessingOptions,
    outputPath: row.output_path,
    resultPath: row.result_path,
    processedResultPath: row.processed_result_path,
    totalPages: row.total_pages,
    chaptersCount: row.chapters_count,
    imagesCount: row.images_count,
    tablesCount: row.tables_count,
    tokenUsage: row.token_usage_json ? JSON.parse(row.token_usage_json) : null,
    currentStep: row.current_step,
    progressPercent: row.progress_percent,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    clientIp: row.client_ip,
    userAgent: row.user_agent,
    isOtpBypass: row.is_otp_bypass,
  };
}

export interface CreateTaskInput {
  id: string;
  sessionId: string;
  originalFilename: string;
  filePath: string;
  options: ProcessingOptions;
  clientIp: string;
  userAgent: string;
  isOtpBypass: boolean;
}

export function createTask(input: CreateTaskInput): Task {
  const db = readDatabase();

  const record: TaskRecord = {
    id: input.id,
    session_id: input.sessionId,
    is_sample: false,
    status: 'queued',
    original_filename: input.originalFilename,
    file_path: input.filePath,
    options_json: JSON.stringify(input.options),
    output_path: null,
    result_path: null,
    processed_result_path: null,
    total_pages: null,
    chapters_count: null,
    images_count: null,
    tables_count: null,
    token_usage_json: null,
    current_step: null,
    progress_percent: 0,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    error_code: null,
    error_message: null,
    client_ip: input.clientIp,
    user_agent: input.userAgent,
    is_otp_bypass: input.isOtpBypass,
  };

  db.tasks.push(record);
  writeDatabase(db);

  return recordToTask(record);
}

export function getTaskById(id: string): Task | null {
  const db = readDatabase();
  const record = db.tasks.find((t) => t.id === id);
  return record ? recordToTask(record) : null;
}

/**
 * Gets a task by ID with session validation.
 * Sample tasks are accessible to all users regardless of session.
 * Returns null if task doesn't exist or belongs to a different session.
 */
export function getTaskByIdForSession(
  id: string,
  sessionId: string,
): Task | null {
  const db = readDatabase();
  const record = db.tasks.find(
    (t) => t.id === id && (t.is_sample || t.session_id === sessionId),
  );
  return record ? recordToTask(record) : null;
}

export interface ListTasksOptions {
  limit?: number;
  offset?: number;
  status?: TaskStatus;
  sessionId?: string;
}

export function listTasks(options: ListTasksOptions = {}): {
  tasks: Task[];
  total: number;
} {
  const db = readDatabase();
  const { limit = 20, offset = 0, status, sessionId } = options;

  let filtered = db.tasks;

  // Filter by session ID (required for user isolation)
  // Sample tasks are visible to all users
  if (sessionId) {
    filtered = filtered.filter(
      (t) => t.is_sample || t.session_id === sessionId,
    );
  }

  // Filter by status (optional)
  if (status) {
    filtered = filtered.filter((t) => t.status === status);
  }

  // Sort by created_at descending
  filtered.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const total = filtered.length;
  const paged = filtered.slice(offset, offset + limit);

  return {
    tasks: paged.map(recordToTask),
    total,
  };
}

export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  updates?: Partial<{
    currentStep: string;
    progressPercent: number;
    startedAt: string;
    completedAt: string;
    errorCode: string;
    errorMessage: string;
  }>,
): void {
  const db = readDatabase();
  const record = db.tasks.find((t) => t.id === id);
  if (!record) return;

  record.status = status;
  if (updates?.currentStep !== undefined)
    record.current_step = updates.currentStep;
  if (updates?.progressPercent !== undefined)
    record.progress_percent = updates.progressPercent;
  if (updates?.startedAt !== undefined) record.started_at = updates.startedAt;
  if (updates?.completedAt !== undefined)
    record.completed_at = updates.completedAt;
  if (updates?.errorCode !== undefined) record.error_code = updates.errorCode;
  if (updates?.errorMessage !== undefined)
    record.error_message = updates.errorMessage;

  writeDatabase(db);
}

export function updateTaskProgress(
  id: string,
  currentStep: string,
  progressPercent: number,
): void {
  const db = readDatabase();
  const record = db.tasks.find((t) => t.id === id);
  if (!record) return;

  record.current_step = currentStep;
  record.progress_percent = progressPercent;
  writeDatabase(db);
}

export function updateTaskResult(
  id: string,
  result: {
    outputPath: string;
    resultPath: string;
    processedResultPath: string;
    totalPages: number;
    chaptersCount: number;
    imagesCount: number;
    tablesCount: number;
    tokenUsage: unknown;
  },
): void {
  const db = readDatabase();
  const record = db.tasks.find((t) => t.id === id);
  if (!record) return;

  record.output_path = result.outputPath;
  record.result_path = result.resultPath;
  record.processed_result_path = result.processedResultPath;
  record.total_pages = result.totalPages;
  record.chapters_count = result.chaptersCount;
  record.images_count = result.imagesCount;
  record.tables_count = result.tablesCount;
  record.token_usage_json = JSON.stringify(result.tokenUsage);
  record.status = 'completed';
  record.completed_at = new Date().toISOString();
  record.progress_percent = 100;

  writeDatabase(db);
}

export function deleteTask(id: string): { success: boolean; error?: string } {
  const db = readDatabase();
  const record = db.tasks.find((t) => t.id === id);

  if (!record) {
    return { success: false, error: 'Task not found' };
  }

  if (record.is_sample && !sampleTaskConfig.allowDeletion) {
    return { success: false, error: 'Sample tasks cannot be deleted' };
  }

  const index = db.tasks.findIndex((t) => t.id === id);
  db.tasks.splice(index, 1);
  db.logs = db.logs.filter((l) => l.task_id !== id);
  writeDatabase(db);
  return { success: true };
}

export function getQueuedTasks(): Task[] {
  const db = readDatabase();
  const queued = db.tasks
    .filter((t) => t.status === 'queued')
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  return queued.map(recordToTask);
}

export function getRunningTasksCount(): number {
  const db = readDatabase();
  return db.tasks.filter((t) => t.status === 'running').length;
}
