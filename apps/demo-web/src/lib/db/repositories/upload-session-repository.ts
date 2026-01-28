import type { UploadSessionRecord } from '../index';

import type { ProcessingOptions } from '~/features/upload';

import { readDatabase, writeDatabase } from '../index';

export type UploadSessionStatus =
  | 'uploading'
  | 'completed'
  | 'expired'
  | 'cancelled';

export interface UploadSession {
  id: string;
  sessionId: string;
  filename: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: number[];
  chunkDir: string;
  clientIp: string;
  isOtpBypass: boolean;
  options: ProcessingOptions;
  status: UploadSessionStatus;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

function recordToUploadSession(record: UploadSessionRecord): UploadSession {
  return {
    id: record.id,
    sessionId: record.session_id,
    filename: record.filename,
    fileSize: record.file_size,
    totalChunks: record.total_chunks,
    receivedChunks: JSON.parse(record.received_chunks) as number[],
    chunkDir: record.chunk_dir,
    clientIp: record.client_ip,
    isOtpBypass: record.is_otp_bypass,
    options: JSON.parse(record.options_json) as ProcessingOptions,
    status: record.status,
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    completedAt: record.completed_at,
  };
}

export interface CreateUploadSessionInput {
  id: string;
  sessionId: string;
  filename: string;
  fileSize: number;
  totalChunks: number;
  chunkDir: string;
  clientIp: string;
  isOtpBypass: boolean;
  options: ProcessingOptions;
  expiresAt: string;
}

export function createUploadSession(
  input: CreateUploadSessionInput,
): UploadSession {
  const db = readDatabase();

  const record: UploadSessionRecord = {
    id: input.id,
    session_id: input.sessionId,
    filename: input.filename,
    file_size: input.fileSize,
    total_chunks: input.totalChunks,
    received_chunks: JSON.stringify([]),
    chunk_dir: input.chunkDir,
    client_ip: input.clientIp,
    is_otp_bypass: input.isOtpBypass,
    options_json: JSON.stringify(input.options),
    status: 'uploading',
    created_at: new Date().toISOString(),
    expires_at: input.expiresAt,
    completed_at: null,
  };

  db.uploadSessions.push(record);
  writeDatabase(db);

  return recordToUploadSession(record);
}

export function getUploadSessionById(id: string): UploadSession | null {
  const db = readDatabase();
  const record = db.uploadSessions.find((s) => s.id === id);
  return record ? recordToUploadSession(record) : null;
}

export function getUploadSessionByIdForSession(
  id: string,
  sessionId: string,
): UploadSession | null {
  const db = readDatabase();
  const record = db.uploadSessions.find(
    (s) => s.id === id && s.session_id === sessionId,
  );
  return record ? recordToUploadSession(record) : null;
}

export function addReceivedChunk(id: string, chunkIndex: number): void {
  const db = readDatabase();
  const record = db.uploadSessions.find((s) => s.id === id);
  if (!record) return;

  const receivedChunks = JSON.parse(record.received_chunks) as number[];
  if (!receivedChunks.includes(chunkIndex)) {
    receivedChunks.push(chunkIndex);
    receivedChunks.sort((a, b) => a - b);
    record.received_chunks = JSON.stringify(receivedChunks);
    writeDatabase(db);
  }
}

export function isAllChunksReceived(id: string): boolean {
  const db = readDatabase();
  const record = db.uploadSessions.find((s) => s.id === id);
  if (!record) return false;

  const receivedChunks = JSON.parse(record.received_chunks) as number[];
  return receivedChunks.length === record.total_chunks;
}

export function updateUploadSessionStatus(
  id: string,
  status: UploadSessionStatus,
): void {
  const db = readDatabase();
  const record = db.uploadSessions.find((s) => s.id === id);
  if (!record) return;

  record.status = status;
  if (status === 'completed') {
    record.completed_at = new Date().toISOString();
  }
  writeDatabase(db);
}

export function deleteUploadSession(id: string): boolean {
  const db = readDatabase();
  const index = db.uploadSessions.findIndex((s) => s.id === id);
  if (index === -1) return false;

  db.uploadSessions.splice(index, 1);
  writeDatabase(db);
  return true;
}

export function getExpiredUploadSessions(): UploadSession[] {
  const db = readDatabase();
  const now = new Date().toISOString();

  return db.uploadSessions
    .filter((s) => s.status === 'uploading' && s.expires_at < now)
    .map(recordToUploadSession);
}

export function getUploadingSessionsCount(sessionId: string): number {
  const db = readDatabase();
  return db.uploadSessions.filter(
    (s) => s.session_id === sessionId && s.status === 'uploading',
  ).length;
}
