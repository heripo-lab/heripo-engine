'use client';

import type {
  ChunkedUploadState,
  ChunkedUploadStatus,
} from '../hooks/use-chunked-upload';

import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Progress } from '~/components/ui/progress';

interface UploadProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ChunkedUploadState;
  onCancel: () => void;
  onRetry?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getStatusIcon(status: ChunkedUploadStatus) {
  switch (status) {
    case 'idle':
      return <Upload className="h-5 w-5 text-gray-500" />;
    case 'creating-session':
    case 'uploading':
    case 'completing':
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'error':
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    case 'cancelled':
      return <XCircle className="h-5 w-5 text-gray-500" />;
  }
}

function getStatusTitle(status: ChunkedUploadStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready to Upload';
    case 'creating-session':
      return 'Creating Upload Session...';
    case 'uploading':
      return 'Uploading File...';
    case 'completing':
      return 'Finalizing Upload...';
    case 'completed':
      return 'Upload Complete';
    case 'error':
      return 'Upload Failed';
    case 'cancelled':
      return 'Upload Cancelled';
  }
}

function getStatusDescription(state: ChunkedUploadState): string {
  switch (state.status) {
    case 'idle':
      return 'Your file will be uploaded in chunks for reliability.';
    case 'creating-session':
      return 'Verifying permissions and preparing upload...';
    case 'uploading':
      return `Uploading chunk ${state.currentChunk} of ${state.totalChunks}`;
    case 'completing':
      return 'Merging chunks and starting processing...';
    case 'completed':
      return 'Your file has been uploaded and processing has started.';
    case 'error':
      return state.error || 'An unexpected error occurred.';
    case 'cancelled':
      return 'The upload was cancelled.';
  }
}

export function UploadProgressDialog({
  open,
  onOpenChange,
  state,
  onCancel,
  onRetry,
}: UploadProgressDialogProps) {
  const isInProgress =
    state.status === 'creating-session' ||
    state.status === 'uploading' ||
    state.status === 'completing';

  const canClose =
    state.status === 'completed' ||
    state.status === 'error' ||
    state.status === 'cancelled';

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isInProgress) {
      // Don't allow closing during upload
      return;
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-md"
        showCloseButton={canClose}
        onInteractOutside={(e) => {
          if (isInProgress) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isInProgress) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getStatusIcon(state.status)}
            {getStatusTitle(state.status)}
          </DialogTitle>
          <DialogDescription>{getStatusDescription(state)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Progress Bar */}
          {(state.status === 'uploading' || state.status === 'completing') && (
            <div className="space-y-2">
              <Progress
                value={state.progress}
                indeterminate={state.status === 'completing'}
              />
              <div className="flex justify-between text-sm text-gray-500">
                <span>{state.progress}%</span>
                <span>
                  {formatBytes(state.uploadedBytes)} /{' '}
                  {formatBytes(state.totalBytes)}
                </span>
              </div>
            </div>
          )}

          {/* Creating Session Indicator */}
          {state.status === 'creating-session' && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          )}

          {/* Error Details */}
          {state.status === 'error' && state.errorCode && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              <p className="font-medium">Error Code: {state.errorCode}</p>
              {state.remainingAttempts !== undefined && (
                <p className="mt-1">
                  Remaining attempts: {state.remainingAttempts}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {isInProgress && (
            <Button variant="outline" onClick={onCancel}>
              Cancel Upload
            </Button>
          )}

          {state.status === 'error' && onRetry && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={onRetry}>Retry Upload</Button>
            </>
          )}

          {(state.status === 'cancelled' || state.status === 'completed') && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
