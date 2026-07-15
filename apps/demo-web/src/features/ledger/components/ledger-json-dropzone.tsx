'use client';

import type { ChangeEvent, DragEvent, MouseEvent } from 'react';

import { FileJson, FileUp, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '~/lib/utils';

// Keep in sync with LEDGER_INPUT_MAX_SIZE_BYTES on the server
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// Browsers may report an empty MIME type or application/octet-stream for
// .json files, so the extension is the primary check
const ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'text/json',
  'application/octet-stream',
  '',
]);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  if (
    !file.name.toLowerCase().endsWith('.json') ||
    !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return 'Only a single processed-document.json file is supported.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File size exceeds 100MB limit.';
  }
  return null;
}

interface LedgerJsonDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  disabled?: boolean;
}

export function LedgerJsonDropzone({
  file,
  onFileChange,
  disabled = false,
}: LedgerJsonDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = (candidate: File) => {
    setError(null);
    const validationError = validateFile(candidate);
    if (validationError) {
      setError(validationError);
      return;
    }
    onFileChange(candidate);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    // Reset input value to allow re-selecting the same file
    e.target.value = '';
  };

  const handleRemoveFile = (e: MouseEvent) => {
    e.stopPropagation();
    onFileChange(null);
    setError(null);
  };

  // Show selected file state
  if (file) {
    return (
      <div
        className={cn(
          'border-primary/50 bg-primary/5 relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
        )}
      >
        <div className="flex flex-col items-center justify-center space-y-4 text-center">
          <div className="bg-primary/10 rounded-full p-4">
            <FileJson className="text-primary h-10 w-10" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium">{file.name}</p>
            <p className="text-muted-foreground text-sm">
              {formatFileSize(file.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRemoveFile}
            className="bg-destructive/10 text-destructive hover:bg-destructive/20 flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
          >
            <X className="h-4 w-4" />
            Remove File
          </button>
        </div>
      </div>
    );
  }

  // Show dropzone
  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'border-muted-foreground/25 bg-muted/50 relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
        !disabled && 'hover:border-muted-foreground/50 hover:bg-muted/80',
        !disabled && 'cursor-pointer',
        isDragging && 'border-primary bg-primary/5',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json,text/json"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <div className="bg-primary/10 rounded-full p-4">
          <FileUp className="text-primary h-10 w-10" />
        </div>
        <div className="space-y-2">
          <p className="text-lg font-medium">
            Drop your processed-document.json here, or click to browse
          </p>
          <p className="text-muted-foreground text-sm">
            Upload a single ProcessedDocument JSON file exported from the raw
            data extraction stage (max 100MB). ZIP archives are not supported.
          </p>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <div className="bg-primary text-primary-foreground flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium">
          <Upload className="h-4 w-4" />
          Select File
        </div>
      </div>
    </div>
  );
}
