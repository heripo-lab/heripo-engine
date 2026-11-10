'use client';

import { useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';

import type { ApiResponseError } from '~/lib/api/tasks';
import { publicModeConfig } from '~/lib/config/public-mode';

/** What a task-creating request carries for the public-demo guard. */
export interface PublicDemoAuth {
  bypassCode?: string;
  turnstileToken?: string;
}

const OTP_ERROR_CODES = ['INVALID_OTP', 'OTP_LOCKED', 'OTP_PERMANENTLY_LOCKED'];

/**
 * The consent (Turnstile) and OTP bypass steps before a task-creating request, as the PDF flow has them:
 * `start` opens the consent dialog, OTP mode (`?otp=true` in public mode) then asks for a bypass code once,
 * and `submit` receives what the request should carry. Spread `consentDialogProps` and `bypassDialogProps`
 * into `ConsentDialog` and `BypassDialog`.
 */
export function usePublicDemoAuth(submit: (auth: PublicDemoAuth) => void) {
  const searchParams = useSearchParams();
  const isPublicMode = publicModeConfig.isPublicMode;
  const isOtpMode = isPublicMode && searchParams.get('otp') === 'true';
  const [consentOpen, setConsentOpen] = useState(false);
  const [bypassOpen, setBypassOpen] = useState(false);
  const [bypassCode, setBypassCode] = useState('');
  const [otpError, setOtpError] = useState<string | undefined>();
  const [remainingAttempts, setRemainingAttempts] = useState<
    number | undefined
  >();
  const [permanentlyLocked, setPermanentlyLocked] = useState(false);
  const turnstileTokenRef = useRef<string | undefined>(undefined);

  const send = (code: string) => {
    setOtpError(undefined);
    submit({
      bypassCode: code || undefined,
      turnstileToken: turnstileTokenRef.current,
    });
  };

  return {
    isPublicMode,
    isOtpMode,
    bypassCode,
    start: () => setConsentOpen(true),
    /** Reopens the bypass dialog for an OTP error; returns whether the error was one. */
    handleError: (error: unknown) => {
      const apiError = error as ApiResponseError;
      if (!apiError.code || !OTP_ERROR_CODES.includes(apiError.code))
        return false;
      setOtpError(apiError.message);
      setRemainingAttempts(apiError.remainingAttempts);
      setPermanentlyLocked(apiError.code !== 'INVALID_OTP');
      setBypassOpen(true);
      return true;
    },
    /** Clears the OTP state after a successful request. */
    reset: () => {
      setOtpError(undefined);
      setRemainingAttempts(undefined);
      setPermanentlyLocked(false);
      setBypassCode('');
      turnstileTokenRef.current = undefined;
    },
    consentDialogProps: {
      open: consentOpen,
      onOpenChange: setConsentOpen,
      onConfirm: (turnstileToken?: string) => {
        setConsentOpen(false);
        turnstileTokenRef.current = turnstileToken;
        if (isOtpMode && !bypassCode) {
          setBypassOpen(true);
          return;
        }
        send(bypassCode);
      },
      isPublicMode,
      isOfficialDemo: publicModeConfig.isOfficialDemo,
    },
    bypassDialogProps: {
      open: bypassOpen,
      onOpenChange: setBypassOpen,
      onSuccess: (code: string) => {
        setBypassCode(code);
        setBypassOpen(false);
        send(code);
      },
      error: otpError,
      remainingAttempts,
      isPermanentlyLocked: permanentlyLocked,
    },
  };
}
