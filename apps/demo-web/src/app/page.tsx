'use client';

import type { FormEvent } from 'react';

import { useForm } from '@tanstack/react-form';
import { Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import type { ApiResponseError } from '~/lib/api/tasks';
import { publicModeConfig } from '~/lib/config/public-mode';

import { MobileWarningBanner } from '~/components/layout/mobile-warning-banner';
import { PipelineStepper } from '~/components/pipeline/pipeline-stepper';
import { Card, CardContent } from '~/components/ui/card';
import {
  AdvancedOptionsCard,
  BypassDialog,
  ConsentDialog,
  DEFAULT_FORM_VALUES,
  KnownLimitationsBanner,
  LLMModelSettingsCard,
  PdfDropzone,
  ProcessingFormProvider,
  ProcessingOptionsCard,
  PublicModeInfoBanner,
  RateLimitBanner,
  StartProcessingButton,
  UploadProgressDialog,
  useChunkedUpload,
  useCreateTask,
  useRateLimitCheck,
} from '~/features/upload';
import type { ProcessingFormValues } from '~/features/upload';

// 50MB threshold for chunked upload
const CHUNKED_UPLOAD_THRESHOLD = 50 * 1024 * 1024;

function HomePageContent() {
  const [selectedStage, setSelectedStage] = useState('raw-data');
  const [bypassDialogOpen, setBypassDialogOpen] = useState(false);
  const [bypassCode, setBypassCode] = useState('');
  const [otpError, setOtpError] = useState<string | undefined>();
  const [otpRemainingAttempts, setOtpRemainingAttempts] = useState<
    number | undefined
  >();
  const [otpPermanentlyLocked, setOtpPermanentlyLocked] = useState(false);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [uploadProgressOpen, setUploadProgressOpen] = useState(false);
  const turnstileTokenRef = useRef<string | undefined>(undefined);
  const pendingSubmitRef = useRef<ProcessingFormValues | null>(null);
  const formResetRef = useRef<(() => void) | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const createTaskMutation = useCreateTask();
  const { data: rateLimit } = useRateLimitCheck();
  const chunkedUpload = useChunkedUpload();

  const isPublicMode = publicModeConfig.isPublicMode;
  const hasOtpParam = searchParams.get('otp') === 'true';
  const isOtpMode = isPublicMode && hasOtpParam;
  const isBlocked =
    isPublicMode && rateLimit && !rateLimit.canCreate && !bypassCode;

  // Centralized submit logic for both direct and chunked upload
  const performSubmit = useCallback(
    (value: ProcessingFormValues) => {
      if (!value.file) return;

      const { file, ...options } = value;

      // Clear previous OTP error
      setOtpError(undefined);

      // Check if file needs chunked upload
      if (file.size >= CHUNKED_UPLOAD_THRESHOLD) {
        // Use chunked upload for large files
        setUploadProgressOpen(true);
        chunkedUpload.upload({
          file,
          options,
          bypassCode: bypassCode || undefined,
          turnstileToken: turnstileTokenRef.current,
          onSuccess: (taskId) => {
            // Reset form state
            formResetRef.current?.();
            // Clear OTP state on success
            setOtpError(undefined);
            setOtpRemainingAttempts(undefined);
            setOtpPermanentlyLocked(false);
            setBypassCode('');
            turnstileTokenRef.current = undefined;
            pendingSubmitRef.current = null;
            // Navigate after a short delay to show completion
            setTimeout(() => {
              setUploadProgressOpen(false);
              router.push(`/process/${taskId}`);
            }, 500);
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
              setUploadProgressOpen(false);
              setBypassDialogOpen(true);
            }
          },
        });
      } else {
        // Use direct upload for small files
        createTaskMutation.mutate(
          {
            file,
            options,
            bypassCode: bypassCode || undefined,
            turnstileToken: turnstileTokenRef.current,
          },
          {
            onSuccess: (data) => {
              // Reset form state
              formResetRef.current?.();
              // Clear OTP state on success
              setOtpError(undefined);
              setOtpRemainingAttempts(undefined);
              setOtpPermanentlyLocked(false);
              setBypassCode('');
              turnstileTokenRef.current = undefined;
              pendingSubmitRef.current = null;
              router.push(`/process/${data.taskId}`);
            },
            onError: (error) => {
              // Handle OTP-related errors
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

                // Keep dialog open to show error
                if (!bypassDialogOpen) {
                  setBypassDialogOpen(true);
                }
              }
            },
          },
        );
      }
    },
    [bypassCode, bypassDialogOpen, chunkedUpload, createTaskMutation, router],
  );

  const form = useForm({
    defaultValues: DEFAULT_FORM_VALUES,
    onSubmit: async ({ value }: { value: ProcessingFormValues }) => {
      // Store pending submit value for retry
      pendingSubmitRef.current = value;
      performSubmit(value);
    },
  });

  // Reset form to defaults when returning to this page after navigation.
  // React 19 Activity re-fires useEffect on show, ensuring stale values are cleared.
  useEffect(() => {
    form.reset();
  }, [form]);

  // Store form reset function in ref for use in callbacks
  formResetRef.current = form.reset;

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Always show consent dialog first
    setConsentDialogOpen(true);
  };

  const handleConsentConfirm = (turnstileToken?: string) => {
    setConsentDialogOpen(false);
    turnstileTokenRef.current = turnstileToken;

    // After consent, check if OTP mode is enabled (show OTP UI regardless of rate limit)
    if (isOtpMode && !bypassCode) {
      setBypassDialogOpen(true);
      return;
    }

    form.handleSubmit();
  };

  const handleOtpSuccess = (code: string) => {
    setBypassCode(code);
    setBypassDialogOpen(false);
    // Submit directly after OTP success (consent already confirmed)
    form.handleSubmit();
  };

  const buttonDisabledReason =
    isBlocked && !hasOtpParam
      ? rateLimit?.reason || 'Rate limit reached.'
      : undefined;

  return (
    <ProcessingFormProvider form={form}>
      <div className="container mx-auto px-4 py-10 xl:px-0">
        <MobileWarningBanner />
        <div className="mx-auto max-w-7xl space-y-8">
          {/* Hero Section */}
          <div className="space-y-4 text-center">
            <h1 className="text-4xl font-bold tracking-tight">
              Archaeological Data Pipeline
            </h1>
            <p className="text-muted-foreground text-lg">
              Extract, standardize, and transform archaeological excavation
              report data
            </p>
            <p className="text-muted-foreground text-sm">
              This is a demo for trying out the features of{' '}
              <a
                href="https://github.com/heripo-lab/heripo-engine"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
              >
                heripo engine
              </a>
              , an open source project — not a commercial product.
            </p>
          </div>

          {/* Pipeline Stepper */}
          <PipelineStepper
            selectedStage={selectedStage}
            onStageSelect={setSelectedStage}
          />

          {/* Stage Content */}
          {selectedStage === 'raw-data' ? (
            <form onSubmit={handleFormSubmit}>
              {/* Known Limitations Banner */}
              <KnownLimitationsBanner />

              {/* Info Banner - Always visible in public mode when not blocked */}
              {isPublicMode && !isBlocked && rateLimit && (
                <PublicModeInfoBanner
                  todayCompleted={rateLimit.todayCompleted}
                  dailyLimit={rateLimit.dailyLimit}
                  remaining={rateLimit.remaining}
                  resetsAt={rateLimit.resetsAt}
                />
              )}

              {/* Rate Limit Banner - Only when blocked */}
              {isBlocked && rateLimit && (
                <RateLimitBanner
                  message={rateLimit.reason}
                  resetsAt={rateLimit.resetsAt}
                />
              )}

              {/* Upload Section */}
              <PdfDropzone />

              {/* Options Section */}
              <div className="mt-8 space-y-6">
                {/* Row 1: Processing + Advanced Options */}
                <div className="grid gap-6 md:grid-cols-2">
                  <ProcessingOptionsCard disabled={isPublicMode} />
                  <AdvancedOptionsCard disabled={isPublicMode} />
                </div>

                {/* Row 2: LLM Model Settings (full width) */}
                <LLMModelSettingsCard disabled={isPublicMode} />
              </div>

              {/* Start Button */}
              <div className="mt-8 flex justify-center">
                <StartProcessingButton
                  isPending={
                    createTaskMutation.isPending ||
                    createTaskMutation.isSuccess ||
                    chunkedUpload.state.status === 'creating-session' ||
                    chunkedUpload.state.status === 'uploading' ||
                    chunkedUpload.state.status === 'completing' ||
                    chunkedUpload.state.status === 'completed'
                  }
                  disabled={isBlocked && !isOtpMode}
                  disabledReason={buttonDisabledReason}
                />
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
                isPending={createTaskMutation.isPending}
                isPublicMode={isPublicMode}
                isOfficialDemo={publicModeConfig.isOfficialDemo}
              />

              {/* Upload Progress Dialog (for large files) */}
              <UploadProgressDialog
                open={uploadProgressOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    chunkedUpload.reset();
                  }
                  setUploadProgressOpen(open);
                }}
                state={chunkedUpload.state}
                onCancel={() => {
                  chunkedUpload.cancel();
                }}
                onRetry={
                  pendingSubmitRef.current
                    ? () => {
                        chunkedUpload.reset();
                        performSubmit(pendingSubmitRef.current!);
                      }
                    : undefined
                }
              />
            </form>
          ) : (
            /* Coming Soon Content for other stages */
            <Card className="mx-auto max-w-lg">
              <CardContent className="flex flex-col items-center gap-4 py-12">
                <div className="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
                  <Lock className="text-muted-foreground h-8 w-8" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-semibold">Coming Soon</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    This pipeline stage is currently under development.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </ProcessingFormProvider>
  );
}

function HomePageLoading() {
  return (
    <div className="container mx-auto px-4 py-10 xl:px-0">
      <MobileWarningBanner />
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Archaeological Data Pipeline
          </h1>
          <p className="text-muted-foreground text-lg">Loading...</p>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageLoading />}>
      <HomePageContent />
    </Suspense>
  );
}
