'use client';

import { ArrowRight, Info, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

import type { ApiResponseError } from '~/lib/api/tasks';
import { publicModeConfig } from '~/lib/config/public-mode';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import {
  BypassDialog,
  ConsentDialog,
  RateLimitBanner,
  useRateLimitCheck,
} from '~/features/upload';

import { useCreateLedgerTask } from '../hooks/use-create-ledger-task';
import { LedgerJsonDropzone } from './ledger-json-dropzone';

/**
 * Upload panel for the Ledger Extraction stage.
 *
 * Accepts a single processed-document.json file and creates a ledger task.
 * PDF processing options and LLM model settings do not apply here, so none
 * are shown. The same public-demo protections as the PDF flow are reused
 * (consent + Turnstile, OTP bypass, rate limits enforced server-side).
 */
export function LedgerStagePanel() {
  const [file, setFile] = useState<File | null>(null);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [bypassDialogOpen, setBypassDialogOpen] = useState(false);
  const [bypassCode, setBypassCode] = useState('');
  const [otpError, setOtpError] = useState<string | undefined>();
  const [otpRemainingAttempts, setOtpRemainingAttempts] = useState<
    number | undefined
  >();
  const [otpPermanentlyLocked, setOtpPermanentlyLocked] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const turnstileTokenRef = useRef<string | undefined>(undefined);
  const router = useRouter();
  const searchParams = useSearchParams();
  const createLedgerTaskMutation = useCreateLedgerTask();
  const { data: rateLimit } = useRateLimitCheck();

  const isPublicMode = publicModeConfig.isPublicMode;
  const isOtpMode = isPublicMode && searchParams.get('otp') === 'true';
  const isBlocked =
    isPublicMode && rateLimit && !rateLimit.canCreate && !bypassCode;

  const performSubmit = (code: string) => {
    if (!file) return;

    setOtpError(undefined);
    setSubmitError(null);

    createLedgerTaskMutation.mutate(
      {
        file,
        bypassCode: code || undefined,
        turnstileToken: turnstileTokenRef.current,
      },
      {
        onSuccess: (data) => {
          setFile(null);
          setOtpError(undefined);
          setOtpRemainingAttempts(undefined);
          setOtpPermanentlyLocked(false);
          setBypassCode('');
          turnstileTokenRef.current = undefined;
          router.push(`/process/${data.taskId}`);
        },
        onError: (error) => {
          const apiError = error as ApiResponseError;

          if (
            apiError.code === 'INVALID_OTP' ||
            apiError.code === 'OTP_LOCKED' ||
            apiError.code === 'OTP_PERMANENTLY_LOCKED'
          ) {
            setOtpError(apiError.message);
            setOtpRemainingAttempts(apiError.remainingAttempts);
            setOtpPermanentlyLocked(
              apiError.code === 'OTP_PERMANENTLY_LOCKED' ||
                apiError.code === 'OTP_LOCKED',
            );
            setBypassDialogOpen(true);
            return;
          }

          setSubmitError(apiError.message || 'Failed to create ledger task');
        },
      },
    );
  };

  const handleStartClick = () => {
    if (!file) return;
    setConsentDialogOpen(true);
  };

  const handleConsentConfirm = (turnstileToken?: string) => {
    setConsentDialogOpen(false);
    turnstileTokenRef.current = turnstileToken;

    if (isOtpMode && !bypassCode) {
      setBypassDialogOpen(true);
      return;
    }

    performSubmit(bypassCode);
  };

  const handleOtpSuccess = (code: string) => {
    setBypassCode(code);
    setBypassDialogOpen(false);
    performSubmit(code);
  };

  const isPending = createLedgerTaskMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Input contract notice */}
      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="text-primary mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="text-muted-foreground text-sm">
            <p className="text-foreground font-medium">
              Ledger extraction preview
            </p>
            <p className="mt-1">
              This stage takes the <code>processed-document.json</code> file
              produced by the raw data extraction stage and validates that the
              data was delivered intact (temporary validation view). PDF parsing
              and document preprocessing are skipped entirely. Image paths must
              be public CDN URLs; they are used as-is and never fetched during
              extraction.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Rate Limit Banner - Only when blocked */}
      {isBlocked && rateLimit && (
        <RateLimitBanner
          message={rateLimit.reason}
          resetsAt={
            rateLimit.weeklyLocked
              ? (rateLimit.weeklyLockedUntil ?? undefined)
              : rateLimit.resetsAt
          }
        />
      )}

      {/* JSON Upload Section */}
      <LedgerJsonDropzone
        file={file}
        onFileChange={(nextFile) => {
          setFile(nextFile);
          setSubmitError(null);
        }}
        disabled={isPending}
      />

      {/* Submit error */}
      {submitError && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border p-4 text-sm">
          {submitError}
        </div>
      )}

      {/* Start Button */}
      <div className="flex justify-center">
        <Button
          type="button"
          size="lg"
          onClick={handleStartClick}
          disabled={!file || isPending || (!!isBlocked && !isOtpMode)}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading & Validating...
            </>
          ) : (
            <>
              Start Ledger Extraction
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {/* Bypass Dialog */}
      <BypassDialog
        open={bypassDialogOpen}
        onOpenChange={setBypassDialogOpen}
        onSuccess={handleOtpSuccess}
        error={otpError}
        remainingAttempts={otpRemainingAttempts}
        isPermanentlyLocked={otpPermanentlyLocked}
      />

      {/* Consent Dialog */}
      <ConsentDialog
        open={consentDialogOpen}
        onOpenChange={setConsentDialogOpen}
        onConfirm={handleConsentConfirm}
        isPending={isPending}
        isPublicMode={isPublicMode}
        isOfficialDemo={publicModeConfig.isOfficialDemo}
      />
    </div>
  );
}
