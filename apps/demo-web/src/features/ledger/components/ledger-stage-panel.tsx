'use client';

import { ArrowRight, Info, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

import { Button } from '~/components/ui/button';
import { Card, CardContent } from '~/components/ui/card';
import {
  BypassDialog,
  ConsentDialog,
  RateLimitBanner,
  usePublicDemoAuth,
  useRateLimitCheck,
} from '~/features/upload';

import { DEFAULT_LEDGER_MODELS } from '../constants/ledger-run';
import { useCreateLedgerTask } from '../hooks/use-create-ledger-task';
import { LedgerJsonDropzone } from './ledger-json-dropzone';
import { LedgerModelSelect } from './ledger-model-select';

const text = {
  ko: {
    title: '원장 추출',
    note: '전처리 단계가 만든 processed-document.json으로 고고학 데이터 원장을 만듭니다.',
    failed: '원장 작업을 만들지 못했습니다',
    uploading: '올리고 확인하는 중…',
    start: '원장 추출 시작',
  },
  en: {
    title: 'Ledger Extraction',
    note: 'Builds the archaeological data ledger from the processed-document.json made by preprocessing.',
    failed: 'Failed to create ledger task',
    uploading: 'Uploading & Validating...',
    start: 'Start Ledger Extraction',
  },
} as const;

/**
 * Upload panel for the Ledger Extraction stage.
 *
 * Accepts a single processed-document.json file and the model of each step
 * of the automatic ledger run (default Claude Haiku 5.5), and creates a ledger task.
 * PDF processing options do not apply here. The same public-demo protections as the PDF flow are reused
 * (consent + Turnstile, OTP bypass, rate limits enforced server-side).
 */
export function LedgerStagePanel() {
  const t = text[useBrowserLanguage()];
  const [file, setFile] = useState<File | null>(null);
  const [models, setModels] = useState(DEFAULT_LEDGER_MODELS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const router = useRouter();
  const createLedgerTaskMutation = useCreateLedgerTask();
  const { data: rateLimit } = useRateLimitCheck();

  const auth = usePublicDemoAuth(({ bypassCode, turnstileToken }) => {
    if (!file) return;
    setSubmitError(null);
    createLedgerTaskMutation.mutate(
      { file, models, bypassCode, turnstileToken },
      {
        onSuccess: (data) => {
          setFile(null);
          auth.reset();
          router.push(`/process/${data.taskId}`);
        },
        onError: (error) => {
          if (auth.handleError(error)) return;
          setSubmitError(error.message || t.failed);
        },
      },
    );
  });
  const { isPublicMode, isOtpMode } = auth;
  const isBlocked =
    isPublicMode && rateLimit && !rateLimit.canCreate && !auth.bypassCode;

  const handleStartClick = () => {
    if (!file) return;
    auth.start();
  };

  const isPending = createLedgerTaskMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Input contract notice */}
      <Card>
        <CardContent className="flex items-start gap-3 py-4">
          <Info className="text-primary mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="text-muted-foreground text-sm">
            <p className="text-foreground font-medium">{t.title}</p>
            <p className="mt-1">{t.note}</p>
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

      <LedgerModelSelect
        value={models}
        onChange={setModels}
        disabled={isPending}
        restricted={isPublicMode && !isOtpMode}
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
              {t.uploading}
            </>
          ) : (
            <>
              {t.start}
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      {/* Bypass Dialog */}
      <BypassDialog {...auth.bypassDialogProps} />

      {/* Consent Dialog */}
      <ConsentDialog {...auth.consentDialogProps} isPending={isPending} />
    </div>
  );
}
