'use client';

import { AlertTriangle, Construction, ExternalLink, Info } from 'lucide-react';
import Link from 'next/link';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { KNOWN_LIMITATIONS } from '~/features/upload/constants/known-limitations';
import { useBrowserLanguage } from '~/features/upload/hooks/use-browser-language';

const GITHUB_ISSUES_URL = 'https://github.com/heripo-lab/heripo-engine/issues';

interface ProcessErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error?: { code: string; message: string };
}

export function ProcessErrorDialog({
  open,
  onOpenChange,
  error,
}: ProcessErrorDialogProps) {
  const lang = useBrowserLanguage();

  const technicalLimitations = KNOWN_LIMITATIONS.filter(
    (l) => l.id !== 'automation-scope',
  );
  const automationScope = KNOWN_LIMITATIONS.find(
    (l) => l.id === 'automation-scope',
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            {lang === 'ko' ? '처리 실패' : 'Processing Failed'}
          </DialogTitle>
          <DialogDescription>
            {lang === 'ko'
              ? '문서 처리 중 오류가 발생했습니다.'
              : 'An error occurred during document processing.'}
          </DialogDescription>
        </DialogHeader>

        {/* Error Message */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <strong>Error:</strong> {error.message}
          </div>
        )}

        {/* Known Limitations */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Construction className="h-4 w-4 text-amber-500" />
            {lang === 'ko' ? '알려진 제한사항' : 'Known Limitations'}
          </div>
          <ul className="space-y-2 text-sm text-amber-700">
            {technicalLimitations.map((limitation) => (
              <li key={limitation.id} className="flex items-start gap-2">
                <Construction className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>
                    {lang === 'ko' ? limitation.titleKo : limitation.titleEn}:
                  </strong>{' '}
                  {lang === 'ko'
                    ? limitation.descriptionKo
                    : limitation.descriptionEn}
                </span>
              </li>
            ))}
          </ul>

          {automationScope && (
            <div className="flex items-start gap-2 border-t border-amber-200 pt-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-800">
                  {lang === 'ko'
                    ? automationScope.titleKo
                    : automationScope.titleEn}
                </p>
                <div className="mt-1 space-y-1 text-sm leading-relaxed text-amber-700">
                  {(lang === 'ko'
                    ? automationScope.descriptionKo
                    : automationScope.descriptionEn
                  )
                    .split('\n')
                    .map((paragraph, index) => (
                      <p key={index}>{paragraph}</p>
                    ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Demo Notice */}
        <div className="bg-muted/50 rounded-md border p-3 text-sm">
          {lang === 'ko' ? (
            <>
              <p>
                이 서비스는 완성된 소프트웨어가 아닌 <strong>데모</strong>
                이며, 지속 개선 중인 살아있는 오픈소스 프로젝트입니다.
              </p>
              <p className="mt-2">
                문제가 지속되거나 개선이 필요하다고 느끼시면{' '}
                <a
                  href={GITHUB_ISSUES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
                >
                  GitHub Issues
                  <ExternalLink className="h-3 w-3" />
                </a>
                에 남겨주세요.
              </p>
            </>
          ) : (
            <>
              <p>
                This is a <strong>demo</strong>, not a finished product. It is a
                living open-source project under continuous improvement.
              </p>
              <p className="mt-2">
                If the issue persists or you have suggestions, please report it
                on{' '}
                <a
                  href={GITHUB_ISSUES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
                >
                  GitHub Issues
                  <ExternalLink className="h-3 w-3" />
                </a>
                .
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          <Button asChild>
            <Link href="/tasks">
              {lang === 'ko' ? '작업 목록으로' : 'Go to Tasks'}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
