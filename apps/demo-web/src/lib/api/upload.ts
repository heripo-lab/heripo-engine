import type { CreateTaskResponse, TaskStatus } from './tasks';

import type { ProcessingOptions } from '~/features/upload';

import { ApiResponseError } from './tasks';

export interface CreateUploadSessionInput {
  filename: string;
  fileSize: number;
  fileType: string;
  options?: ProcessingOptions;
  bypassCode?: string;
  turnstileToken?: string;
}

export interface CreateUploadSessionResponse {
  uploadSessionId: string;
  uploadSessionToken: string;
  totalChunks: number;
  chunkSize: number;
  expiresAt: string;
}

export interface UploadChunkInput {
  uploadSessionToken: string;
  chunkIndex: number;
  chunk: Blob;
}

export interface UploadChunkResponse {
  success: boolean;
  chunkIndex: number;
  receivedChunks: number;
  totalChunks: number;
  isComplete: boolean;
  message?: string;
}

export interface CompleteUploadInput {
  uploadSessionToken: string;
}

export interface CompleteUploadResponse {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  streamUrl: string;
}

interface ApiError {
  error: string;
  code?: string;
  remainingAttempts?: number;
  receivedChunks?: number;
  totalChunks?: number;
  fileSize?: number;
  threshold?: number;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new ApiResponseError(
      error.error || 'Request failed',
      response.status,
      error,
    );
  }
  return response.json();
}

export async function createUploadSession(
  input: CreateUploadSessionInput,
): Promise<CreateUploadSessionResponse> {
  const response = await fetch('/api/upload/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  return handleResponse<CreateUploadSessionResponse>(response);
}

export async function uploadChunk(
  input: UploadChunkInput,
): Promise<UploadChunkResponse> {
  const formData = new FormData();
  formData.append('chunkIndex', String(input.chunkIndex));
  formData.append('chunk', input.chunk);

  const response = await fetch('/api/upload/chunks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.uploadSessionToken}`,
    },
    body: formData,
  });
  return handleResponse<UploadChunkResponse>(response);
}

export async function completeUpload(
  input: CompleteUploadInput,
): Promise<CompleteUploadResponse> {
  const response = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.uploadSessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return handleResponse<CompleteUploadResponse>(response);
}

export async function cancelUpload(
  uploadSessionId: string,
  uploadSessionToken: string,
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/upload/session/${uploadSessionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${uploadSessionToken}`,
    },
  });
  return handleResponse<{ success: boolean; message: string }>(response);
}

// Re-export CreateTaskResponse for convenience
export type { CreateTaskResponse };
