'use client';

import {
  AlertTriangle,
  Construction,
  ExternalLink,
  FileQuestion,
  Info,
} from 'lucide-react';
import Link from 'next/link';

import type { SupportedLanguage } from '~/lib/hooks/use-browser-language';
import { useBrowserLanguage } from '~/lib/hooks/use-browser-language';

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

const GITHUB_REPO_URL = 'https://github.com/heripo-lab/heripo-engine';
const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

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

  if (error?.code === 'INVALID_DOCUMENT_TYPE') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DocumentValidationErrorContent lang={lang} />
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <GenericErrorContent lang={lang} error={error} />
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

/**
 * Content shown when the document fails archaeological report type validation.
 */
function DocumentValidationErrorContent({ lang }: { lang: SupportedLanguage }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-amber-600">
          <FileQuestion className="h-5 w-5" />
          {lang === 'ko'
            ? '발굴조사보고서가 아닌 것 같습니다'
            : 'This does not appear to be an archaeological report'}
        </DialogTitle>
        <DialogDescription>
          {lang === 'ko'
            ? '업로드한 PDF가 발굴조사보고서로 확인되지 않아 처리가 중단되었습니다.'
            : 'The uploaded PDF was not identified as an archaeological investigation report, so processing was stopped.'}
        </DialogDescription>
      </DialogHeader>

      {/* Why this restriction exists */}
      <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <p className="font-medium">
          {lang === 'ko'
            ? '왜 이런 제한이 있나요?'
            : 'Why does this restriction exist?'}
        </p>
        {lang === 'ko' ? (
          <div className="space-y-2 leading-relaxed">
            <p>
              이 데모는 <strong>발굴조사, 시굴조사, 지표조사</strong> 등 고고학
              현장조사 보고서를 처리하기 위해 만들어졌습니다. 관련 없는 PDF가
              업로드되면 불필요한 LLM 비용이 발생하고, 다른 사용자들이 체험할 수
              있는 기회가 줄어듭니다.
            </p>
            <p>
              이 데모의 LLM 비용은 <strong>heripo lab이 전액 부담</strong>하고
              있어, 제한된 자원을 고고학 보고서 처리에 집중하고자 합니다.
            </p>
          </div>
        ) : (
          <div className="space-y-2 leading-relaxed">
            <p>
              This demo is designed specifically for archaeological
              investigation reports such as{' '}
              <strong>
                excavation, trial excavation, and surface survey reports
              </strong>
              . Processing unrelated PDFs wastes LLM costs and reduces
              availability for other users.
            </p>
            <p>
              All LLM costs for this demo are{' '}
              <strong>fully covered by heripo lab</strong>, so we focus limited
              resources on archaeological report processing.
            </p>
          </div>
        )}
      </div>

      {/* False positive disclaimer */}
      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-2 leading-relaxed">
          {lang === 'ko' ? (
            <>
              <p>
                이 판별은 AI가 PDF 앞뒤 일부 페이지를 샘플링해 가볍게 판단한
                결과입니다.{' '}
                <strong>
                  실제 발굴조사보고서인데도 이 화면이 나타날 수 있습니다.
                </strong>
              </p>
              <p>
                이 기능은 엔진 자체의 기능이 아니라, 많은 분들이 데모를 체험할
                수 있도록 하기 위한 <strong>온라인 데모 전용 제한</strong>
                입니다. 엔진에는 이 제한이 없습니다.
              </p>
            </>
          ) : (
            <>
              <p>
                This check is a lightweight AI-based sampling of a few pages
                from the PDF.{' '}
                <strong>
                  It may incorrectly reject a genuine archaeological report
                </strong>
                , and we sincerely apologize if that happens.
              </p>
              <p>
                This is <strong>not a limitation of the engine itself</strong>{' '}
                &mdash; it is a restriction applied only to the online demo so
                that more people can try it out. The engine has no such
                restriction.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Alternatives */}
      <div className="bg-muted/50 space-y-2 rounded-md border p-4 text-sm">
        <p className="font-medium">
          {lang === 'ko' ? '다른 방법으로 시도하기' : 'Alternative options'}
        </p>
        {lang === 'ko' ? (
          <ul className="list-inside list-disc space-y-1 leading-relaxed">
            <li>
              <strong>다른 보고서</strong>로 다시 시도해 보세요.
            </li>
            <li>
              소스코드를{' '}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
              >
                GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
              에서 내려받아 로컬 환경에서 실행하면{' '}
              <strong>어떤 PDF든 제한 없이</strong> 처리할 수 있습니다.
            </li>
          </ul>
        ) : (
          <ul className="list-inside list-disc space-y-1 leading-relaxed">
            <li>
              <strong>Try again</strong> with a different report.
            </li>
            <li>
              Clone the source code from{' '}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-blue-600 underline underline-offset-4 hover:text-blue-800"
              >
                GitHub
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              and run it locally to process{' '}
              <strong>any PDF without restrictions</strong>.
            </li>
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * Generic error content for non-validation processing failures.
 */
function GenericErrorContent({
  lang,
  error,
}: {
  lang: SupportedLanguage;
  error?: { code: string; message: string };
}) {
  const technicalLimitations = KNOWN_LIMITATIONS.filter(
    (l) => l.id !== 'automation-scope',
  );
  const automationScope = KNOWN_LIMITATIONS.find(
    (l) => l.id === 'automation-scope',
  );

  return (
    <>
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
              If the issue persists or you have suggestions, please report it on{' '}
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
    </>
  );
}
