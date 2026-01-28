'use client';

import type { ChangeEvent, DragEvent, MouseEvent } from 'react';

import { FileText, FileUp, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '~/lib/utils';

import { useProcessingForm } from '../contexts/processing-form-context';

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function validateFile(file: File): string | null {
  if (file.type !== 'application/pdf') {
    return 'Only PDF files are supported.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File size exceeds 2GB limit.';
  }
  return null;
}

interface FieldApi {
  state: { value: File | null };
  handleChange: (value: File | null) => void;
}

export function PdfDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useProcessingForm();

  return (
    <form.Field name="file">
      {(field: FieldApi) => {
        const selectedFile = field.state.value;

        const handleFile = (file: File) => {
          setError(null);
          const validationError = validateFile(file);
          if (validationError) {
            setError(validationError);
            return;
          }
          field.handleChange(file);
        };

        const handleDragOver = (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
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

        const handleClick = () => {
          inputRef.current?.click();
        };

        const handleRemoveFile = (e: MouseEvent) => {
          e.stopPropagation();
          field.handleChange(null);
          setError(null);
        };

        // Show selected file state
        if (selectedFile) {
          return (
            <div
              className={cn(
                'border-primary/50 bg-primary/5 relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
              )}
            >
              <div className="flex flex-col items-center justify-center space-y-4 text-center">
                <div className="bg-primary/10 rounded-full p-4">
                  <FileText className="text-primary h-10 w-10" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-medium">{selectedFile.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {formatFileSize(selectedFile.size)}
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
            onClick={handleClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'border-muted-foreground/25 bg-muted/50 relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors',
              'hover:border-muted-foreground/50 hover:bg-muted/80',
              'cursor-pointer',
              isDragging && 'border-primary bg-primary/5',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="bg-primary/10 rounded-full p-4">
                <FileUp className="text-primary h-10 w-10" />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-medium">
                  Drop your PDF file here, or click to browse
                </p>
                <p className="text-muted-foreground text-sm">
                  Please upload an archaeological excavation report PDF (max
                  2GB)
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
      }}
    </form.Field>
  );
}
