import type {
  Chapter,
  PageRange,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
} from '@heripo/model';

import type { ProcessingOptions } from '~/features/upload';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Task {
  id: string;
  isSample: boolean;
  originalFilename: string;
  status: TaskStatus;
  progressPercent: number;
  chaptersCount: number | null;
  imagesCount: number | null;
  tablesCount: number | null;
  totalPages: number | null;
  tokenUsage: unknown | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStep: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuePosition?: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
  streamUrl: string;
}

export interface TaskResultResponse {
  task: {
    id: string;
    originalFilename: string;
    status: string;
    isSample: boolean;
    totalPages: number;
    chaptersCount: number;
    imagesCount: number;
    tablesCount: number;
    tokenUsage: unknown;
    createdAt: string;
    completedAt: string;
  };
  result: {
    reportId: string;
    pageRangeMap: Record<number, PageRange>;
    chapters: Chapter[];
    images: ProcessedImage[];
    tables: ProcessedTable[];
    footnotes?: ProcessedFootnote[];
  };
}

interface ApiError {
  error: string;
  status?: TaskStatus;
  code?: string;
  remainingAttempts?: number;
}

export class ApiResponseError extends Error {
  public readonly code?: string;
  public readonly remainingAttempts?: number;
  public readonly statusCode: number;

  constructor(message: string, statusCode: number, errorData?: ApiError) {
    super(message);
    this.name = 'ApiResponseError';
    this.statusCode = statusCode;
    this.code = errorData?.code;
    this.remainingAttempts = errorData?.remainingAttempts;
  }
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

export interface FetchTasksParams {
  limit?: number;
  offset?: number;
  status?: string;
}

export async function fetchTasks(
  params: FetchTasksParams = {},
): Promise<TaskListResponse> {
  const searchParams = new URLSearchParams();
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  if (params.status) searchParams.set('status', params.status);

  const response = await fetch(`/api/tasks?${searchParams.toString()}`);
  return handleResponse<TaskListResponse>(response);
}

export async function fetchTask(taskId: string): Promise<Task> {
  const response = await fetch(`/api/tasks/${taskId}`);
  return handleResponse<Task>(response);
}

export async function fetchTaskResult(
  taskId: string,
): Promise<TaskResultResponse> {
  const response = await fetch(`/api/tasks/${taskId}/result`);
  return handleResponse<TaskResultResponse>(response);
}

export interface CreateTaskInput {
  file: File;
  options: ProcessingOptions;
  bypassCode?: string;
  turnstileToken?: string;
}

export async function createTask(
  input: CreateTaskInput,
): Promise<CreateTaskResponse> {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('options', JSON.stringify(input.options));
  if (input.bypassCode) {
    formData.append('bypassCode', input.bypassCode);
  }
  if (input.turnstileToken) {
    formData.append('turnstileToken', input.turnstileToken);
  }

  const response = await fetch('/api/tasks', {
    method: 'POST',
    body: formData,
  });
  return handleResponse<CreateTaskResponse>(response);
}

export async function deleteTask(
  taskId: string,
): Promise<{ success: boolean }> {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  });
  return handleResponse<{ success: boolean }>(response);
}

export async function downloadTaskZip(taskId: string): Promise<Blob> {
  const response = await fetch(`/api/tasks/${taskId}/download`);

  if (!response.ok) {
    const error: ApiError = await response.json();
    throw new ApiResponseError(
      error.error || 'Download failed',
      response.status,
      error,
    );
  }

  return response.blob();
}
