import type {
  DocumentResourceIndex,
  LedgerExtractionPreview,
  PlaceAliasTable,
} from '@heripo/ledger-extractor';
import type {
  Chapter,
  PageRange,
  ProcessedFootnote,
  ProcessedImage,
  ProcessedTable,
  TokenUsageReport,
} from '@heripo/model';

import type { ArchaeologyLedgerView } from '~/lib/ledger/archaeology-ledger';
import type {
  CandidateDiscoveryRun,
  CandidateDiscoveryRunSettings,
} from '~/lib/ledger/candidate-discovery-run';
import type { ContentAttachmentRun } from '~/lib/ledger/content-attachment-run';
import type { ContentAttachmentThinState } from '~/lib/ledger/content-attachment-thin-run';
import type {
  ReportRouterRunSummary,
  StoredReportProfile,
} from '~/lib/ledger/report-profile';

import type { LedgerStageModels } from '~/features/ledger/constants/ledger-run';
import type { ProcessingOptions } from '~/features/upload';

export type TaskStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type TaskKind = 'raw-data' | 'ledger';

export interface Task {
  id: string;
  kind: TaskKind;
  isSample: boolean;
  originalFilename: string;
  status: TaskStatus;
  progressPercent: number;
  chaptersCount: number | null;
  imagesCount: number | null;
  tablesCount: number | null;
  totalPages: number | null;
  tokenUsage: TokenUsageReport | null;
  tokenCostUSD: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  currentStep: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuePosition?: number;
  isOtpBypass: boolean;
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

export interface TaskResultTaskInfo {
  id: string;
  kind: TaskKind;
  originalFilename: string;
  status: string;
  isSample: boolean;
  totalPages: number;
  chaptersCount: number;
  imagesCount: number;
  tablesCount: number;
  tokenUsage: TokenUsageReport | null;
  tokenCostUSD: number | null;
  createdAt: string;
  completedAt: string;
}

export interface ProcessedDocumentResult {
  reportId: string;
  pageRangeMap: Record<number, PageRange>;
  chapters: Chapter[];
  images: ProcessedImage[];
  tables: ProcessedTable[];
  footnotes?: ProcessedFootnote[];
}

export interface RawDataTaskResultResponse {
  task: TaskResultTaskInfo;
  resultKind: 'processed-document';
  result: ProcessedDocumentResult;
}

export interface LedgerTaskResultResponse {
  task: TaskResultTaskInfo;
  resultKind: 'ledger-preview';
  result: LedgerExtractionPreview;
}

export type TaskResultResponse =
  RawDataTaskResultResponse | LedgerTaskResultResponse;

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

export interface DocumentResourceIndexResponse {
  inputSha256: string;
  index: DocumentResourceIndex;
}

export async function fetchCandidateDiscovery(
  taskId: string,
): Promise<{ run: CandidateDiscoveryRun | null }> {
  return handleResponse(await fetch(`/api/tasks/${taskId}/candidates`));
}

export async function startCandidateDiscoveryRun(
  taskId: string,
  settings: CandidateDiscoveryRunSettings,
): Promise<{ run: CandidateDiscoveryRun }> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  );
}

export async function cancelCandidateDiscoveryRun(
  taskId: string,
): Promise<{ success: boolean }> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/candidates`, { method: 'DELETE' }),
  );
}

export async function fetchCandidateDiscoveryAudit(
  taskId: string,
): Promise<unknown> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/candidates?audit=true`),
  );
}

export async function fetchDocumentResourceIndex(
  taskId: string,
): Promise<DocumentResourceIndexResponse> {
  const response = await fetch(`/api/tasks/${taskId}/resource-index`);
  return handleResponse<DocumentResourceIndexResponse>(response);
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

export interface CreateLedgerTaskInput {
  file: File;
  /** The model of each step of the automatic ledger run. */
  models: LedgerStageModels;
  bypassCode?: string;
  turnstileToken?: string;
}

/**
 * Creates a ledger extraction task from a single processed-document.json
 * file. Ledger tasks have no PDF processing options.
 */
export async function createLedgerTask(
  input: CreateLedgerTaskInput,
): Promise<CreateTaskResponse> {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('models', JSON.stringify(input.models));
  if (input.bypassCode) {
    formData.append('bypassCode', input.bypassCode);
  }
  if (input.turnstileToken) {
    formData.append('turnstileToken', input.turnstileToken);
  }

  const response = await fetch('/api/tasks/ledger', {
    method: 'POST',
    body: formData,
  });
  return handleResponse<CreateTaskResponse>(response);
}

/** The ledger task this session made from a completed PDF processing task, if any. */
export async function getLedgerTaskForSource(
  taskId: string,
): Promise<{ ledgerTask: { id: string; status: string } | null }> {
  const response = await fetch(`/api/tasks/${taskId}/ledger-task`);
  return handleResponse(response);
}

/** Make a ledger task from a completed PDF processing task in this session; an existing one is returned. */
export async function createLedgerTaskFromResult(input: {
  taskId: string;
  models: LedgerStageModels;
}): Promise<{ taskId: string; existing: boolean }> {
  const response = await fetch(`/api/tasks/${input.taskId}/ledger-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models: input.models }),
  });
  return handleResponse(response);
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

export async function fetchContentAttachment(taskId: string): Promise<{
  run: ContentAttachmentRun | null;
  thin?: ContentAttachmentThinState | null;
}> {
  return handleResponse(await fetch(`/api/tasks/${taskId}/content-attachment`));
}
export async function prepareContentAttachmentPreview(
  taskId: string,
  maxUnitChars: number,
): Promise<{
  run: ContentAttachmentRun;
}> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', maxUnitChars }),
    }),
  );
}
export async function runFirstContentAttachment(taskId: string): Promise<{
  run: ContentAttachmentRun;
}> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run-first' }),
    }),
  );
}
export async function fetchContentAttachmentAudit(
  taskId: string,
): Promise<unknown> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment?audit=true`),
  );
}
export async function runThinContentAttachment(
  taskId: string,
  budget: {
    maxCalls: number;
    maxTotalTokens: number;
    modelId: string;
    batch: boolean;
  },
): Promise<{
  run: ContentAttachmentRun | null;
  thin: ContentAttachmentThinState;
}> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run-thin', ...budget }),
    }),
  );
}
export async function stopThinContentAttachment(taskId: string): Promise<{
  run: ContentAttachmentRun | null;
  thin: ContentAttachmentThinState;
}> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop-thin' }),
    }),
  );
}
export async function fetchThinContentAttachmentResult(
  taskId: string,
): Promise<unknown> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/content-attachment?thin=result`),
  );
}

/** The task's saved place alias table, if any. */
export async function fetchPlaceAliases(
  taskId: string,
): Promise<{ table: PlaceAliasTable | null }> {
  return handleResponse(await fetch(`/api/tasks/${taskId}/place-aliases`));
}
/** Save a place alias table; it is refused with its validation errors when invalid. */
export async function savePlaceAliasesRequest(
  taskId: string,
  table: unknown,
): Promise<{ table: PlaceAliasTable; warnings: string[] }> {
  const response = await fetch(`/api/tasks/${taskId}/place-aliases`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(table),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      [body.error ?? 'Request failed', ...(body.issues ?? [])].join(': '),
    );
  return body;
}
export async function deletePlaceAliasesRequest(
  taskId: string,
): Promise<{ table: null }> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/place-aliases`, { method: 'DELETE' }),
  );
}

/** The archaeology ledger assembled from the latest thin attachment run, or null before one exists. */
export async function fetchArchaeologyLedger(taskId: string): Promise<{
  ledger: ArchaeologyLedgerView | null;
}> {
  return handleResponse(await fetch(`/api/tasks/${taskId}/ledger`));
}

export async function fetchReportProfile(taskId: string): Promise<{
  stored: StoredReportProfile | null;
  router: ReportRouterRunSummary | null;
}> {
  return handleResponse(await fetch(`/api/tasks/${taskId}/report-profile`));
}

/** Classify the report automatically with one router call. */
export async function runReportRouterRequest(
  taskId: string,
  modelId: string,
): Promise<{
  stored: StoredReportProfile | null;
  router: ReportRouterRunSummary;
}> {
  return handleResponse(
    await fetch(`/api/tasks/${taskId}/report-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'route', modelId }),
    }),
  );
}

/** Save a confirmed profile; validation problems from the server are listed in the error message. */
export async function saveReportProfileRequest(
  taskId: string,
  profile: unknown,
): Promise<{ stored: StoredReportProfile }> {
  const response = await fetch(`/api/tasks/${taskId}/report-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      [body.error ?? 'Request failed', ...(body.issues ?? [])].join(': '),
    );
  return body;
}
