import { readDatabase, writeDatabase } from '../index';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TaskLog {
  id: number;
  taskId: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export function createLog(
  taskId: string,
  level: LogLevel,
  message: string,
): TaskLog {
  const db = readDatabase();
  const timestamp = new Date().toISOString();
  const id = db.nextLogId;

  db.logs.push({
    id,
    task_id: taskId,
    level,
    message,
    timestamp,
  });
  db.nextLogId = id + 1;

  writeDatabase(db);

  return {
    id,
    taskId,
    level,
    message,
    timestamp,
  };
}

export interface GetLogsOptions {
  limit?: number;
  afterId?: number;
}

export function getLogsByTaskId(
  taskId: string,
  options: GetLogsOptions = {},
): TaskLog[] {
  const db = readDatabase();
  const { limit = 100, afterId } = options;

  let logs = db.logs.filter((l) => l.task_id === taskId);

  if (afterId !== undefined) {
    logs = logs.filter((l) => l.id > afterId);
  }

  // Sort by timestamp ascending
  logs.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Apply limit
  logs = logs.slice(0, limit);

  return logs.map((l) => ({
    id: l.id,
    taskId: l.task_id,
    level: l.level as LogLevel,
    message: l.message,
    timestamp: l.timestamp,
  }));
}

export function deleteLogsByTaskId(taskId: string): number {
  const db = readDatabase();
  const initialLength = db.logs.length;
  db.logs = db.logs.filter((l) => l.task_id !== taskId);
  const deletedCount = initialLength - db.logs.length;
  writeDatabase(db);
  return deletedCount;
}
