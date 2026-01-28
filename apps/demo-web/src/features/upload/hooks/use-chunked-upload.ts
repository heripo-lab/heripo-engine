'use client';

import type { ProcessingOptions } from '../types/form-values';

import { useCallback, useRef, useState } from 'react';

import { ApiResponseError } from '~/lib/api/tasks';
import {
  cancelUpload,
  completeUpload,
  createUploadSession,
  uploadChunk,
} from '~/lib/api/upload';

export type ChunkedUploadStatus =
  | 'idle'
  | 'creating-session'
  | 'uploading'
  | 'completing'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface ChunkedUploadState {
  status: ChunkedUploadStatus;
  progress: number; // 0-100
  currentChunk: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  error: string | null;
  errorCode: string | null;
  remainingAttempts: number | undefined;
  taskId: string | null;
}

export interface ChunkedUploadOptions {
  file: File;
  options: ProcessingOptions;
  bypassCode?: string;
  turnstileToken?: string;
  onSuccess?: (taskId: string) => void;
  onError?: (error: Error) => void;
}

const CONCURRENT_UPLOADS = 3;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sliceFile(file: File, chunkSize: number): Blob[] {
  const chunks: Blob[] = [];
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    chunks.push(file.slice(offset, end));
    offset = end;
  }

  return chunks;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useChunkedUpload() {
  const [state, setState] = useState<ChunkedUploadState>({
    status: 'idle',
    progress: 0,
    currentChunk: 0,
    totalChunks: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    error: null,
    errorCode: null,
    remainingAttempts: undefined,
    taskId: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadSessionRef = useRef<{
    id: string;
    token: string;
  } | null>(null);

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      uploadedBytes: 0,
      totalBytes: 0,
      error: null,
      errorCode: null,
      remainingAttempts: undefined,
      taskId: null,
    });
    abortControllerRef.current = null;
    uploadSessionRef.current = null;
  }, []);

  const cancel = useCallback(async () => {
    abortControllerRef.current?.abort();

    if (uploadSessionRef.current) {
      try {
        await cancelUpload(
          uploadSessionRef.current.id,
          uploadSessionRef.current.token,
        );
      } catch {
        // Ignore cancel errors
      }
    }

    setState((prev) => ({
      ...prev,
      status: 'cancelled',
      error: 'Upload cancelled',
    }));
  }, []);

  const upload = useCallback(async (options: ChunkedUploadOptions) => {
    const {
      file,
      options: processingOptions,
      bypassCode,
      turnstileToken,
      onSuccess,
      onError,
    } = options;

    abortControllerRef.current = new AbortController();

    setState({
      status: 'creating-session',
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      uploadedBytes: 0,
      totalBytes: file.size,
      error: null,
      errorCode: null,
      remainingAttempts: undefined,
      taskId: null,
    });

    try {
      // Step 1: Create upload session
      const session = await createUploadSession({
        filename: file.name,
        fileSize: file.size,
        fileType: file.type,
        options: processingOptions,
        bypassCode,
        turnstileToken,
      });

      uploadSessionRef.current = {
        id: session.uploadSessionId,
        token: session.uploadSessionToken,
      };

      const { totalChunks, chunkSize } = session;

      setState((prev) => ({
        ...prev,
        status: 'uploading',
        totalChunks,
      }));

      // Step 2: Slice file into chunks
      const chunks = sliceFile(file, chunkSize);

      // Step 3: Upload chunks with concurrency
      const uploadedChunks = new Set<number>();
      let uploadedBytes = 0;

      const uploadChunkWithRetry = async (index: number): Promise<void> => {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          if (abortControllerRef.current?.signal.aborted) {
            throw new Error('Upload cancelled');
          }

          try {
            const result = await uploadChunk({
              uploadSessionToken: session.uploadSessionToken,
              chunkIndex: index,
              chunk: chunks[index],
            });

            if (result.success) {
              uploadedChunks.add(index);
              uploadedBytes += chunks[index].size;

              setState((prev) => ({
                ...prev,
                currentChunk: uploadedChunks.size,
                uploadedBytes,
                progress: Math.round((uploadedChunks.size / totalChunks) * 100),
              }));

              return;
            }
          } catch (error) {
            if (attempt === MAX_RETRIES - 1) {
              throw error;
            }
            await sleep(RETRY_DELAY_MS * (attempt + 1));
          }
        }
      };

      // Process chunks with limited concurrency
      const queue = Array.from({ length: totalChunks }, (_, i) => i);
      const workers: Promise<void>[] = [];

      const processQueue = async () => {
        while (queue.length > 0) {
          if (abortControllerRef.current?.signal.aborted) {
            return;
          }

          const index = queue.shift();
          if (index !== undefined) {
            await uploadChunkWithRetry(index);
          }
        }
      };

      for (let i = 0; i < Math.min(CONCURRENT_UPLOADS, totalChunks); i++) {
        workers.push(processQueue());
      }

      await Promise.all(workers);

      if (abortControllerRef.current?.signal.aborted) {
        return;
      }

      // Step 4: Complete upload
      setState((prev) => ({
        ...prev,
        status: 'completing',
        progress: 100,
      }));

      const result = await completeUpload({
        uploadSessionToken: session.uploadSessionToken,
      });

      setState((prev) => ({
        ...prev,
        status: 'completed',
        taskId: result.taskId,
      }));

      uploadSessionRef.current = null;
      onSuccess?.(result.taskId);
    } catch (error) {
      let errorMessage = 'Upload failed';
      let errorCode: string | null = null;
      let remainingAttempts: number | undefined;

      if (error instanceof ApiResponseError) {
        errorMessage = error.message;
        errorCode = error.code ?? null;
        remainingAttempts = error.remainingAttempts;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setState((prev) => ({
        ...prev,
        status: 'error',
        error: errorMessage,
        errorCode,
        remainingAttempts,
      }));

      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, []);

  return {
    state,
    upload,
    cancel,
    reset,
  };
}
