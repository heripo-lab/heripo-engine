'use client';

import type { ChangeEvent } from 'react';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';

interface BypassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (code: string) => void;
  error?: string;
  remainingAttempts?: number;
  isPermanentlyLocked?: boolean;
}

export function BypassDialog({
  open,
  onOpenChange,
  onSuccess,
  error,
  remainingAttempts,
  isPermanentlyLocked = false,
}: BypassDialogProps) {
  const [code, setCode] = useState('');

  useEffect(() => {
    if (open) {
      setCode('');
    }
  }, [open]);

  const handleSubmit = () => {
    if (code.length === 6) {
      onSuccess(code);
      setCode('');
      onOpenChange(false);
    }
  };

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '');
    setCode(value.slice(0, 6));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isPermanentlyLocked ? 'Access Blocked' : 'Enter Access Code'}
          </DialogTitle>
          <DialogDescription>
            {isPermanentlyLocked
              ? 'Your access has been permanently blocked due to too many failed attempts.'
              : 'Enter the 6-digit authentication code to bypass usage limits.'}
          </DialogDescription>
        </DialogHeader>

        {/* Error Message */}
        {error && !isPermanentlyLocked && (
          <div className="bg-destructive/10 text-destructive border-destructive/20 flex items-start gap-2 rounded-md border p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 text-sm">
              <p>{error}</p>
              {remainingAttempts !== undefined && remainingAttempts > 0 && (
                <p className="mt-1 font-medium">
                  {remainingAttempts}{' '}
                  {remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining
                </p>
              )}
            </div>
          </div>
        )}

        {/* Permanent Lockout Warning */}
        {isPermanentlyLocked && (
          <div className="bg-destructive/10 text-destructive border-destructive/20 flex items-start gap-2 rounded-md border p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1 text-sm">
              <p className="font-medium">Access Permanently Blocked</p>
              <p className="mt-1">
                Please contact the administrator to restore access.
              </p>
            </div>
          </div>
        )}

        {/* Input Field */}
        {!isPermanentlyLocked && (
          <div className="py-4">
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={handleCodeChange}
              className="text-center text-2xl tracking-widest"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) {
                  handleSubmit();
                }
              }}
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isPermanentlyLocked ? 'Close' : 'Cancel'}
          </Button>
          {!isPermanentlyLocked && (
            <Button onClick={handleSubmit} disabled={code.length !== 6}>
              Submit
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
