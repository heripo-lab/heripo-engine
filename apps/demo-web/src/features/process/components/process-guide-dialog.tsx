'use client';

import { Clock, Info, MonitorX } from 'lucide-react';

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

const TEXT = {
  ko: {
    title: '처리 안내',
    description: '문서 처리가 시작되었습니다.',
    timeStandard:
      '문서 크기와 복잡도에 따라 {{bold}}10분~1시간 이상{{/bold}} 소요될 수 있습니다.',
    timeVlm:
      'VLM(Vision Language Model) 파이프라인은 각 페이지를 비전 모델로 분석하므로 {{bold}}1시간 이상{{/bold}} 소요될 수 있습니다.',
    browserClose:
      '브라우저를 닫거나 페이지를 떠나도 {{bold}}서버에서 처리가 계속{{/bold}}됩니다. Tasks 페이지에서 언제든 진행 상황을 확인할 수 있습니다.',
    confirm: '확인',
  },
  en: {
    title: 'Processing Guide',
    description: 'Document processing has started.',
    timeStandard:
      'Depending on document size and complexity, processing may take {{bold}}10 minutes to over 1 hour{{/bold}}.',
    timeVlm:
      'The VLM (Vision Language Model) pipeline analyzes each page with a vision model, which may take {{bold}}over 1 hour{{/bold}}.',
    browserClose:
      'Processing {{bold}}continues on the server{{/bold}} even if you close the browser or leave this page. You can check progress anytime from the Tasks page.',
    confirm: 'OK',
  },
} as const;

function renderBold(template: string) {
  const parts = template.split(/\{\{bold\}\}|\{\{\/bold\}\}/);
  // parts: [before, bold, after] — odd indices are bold
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

interface ProcessGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: 'standard' | 'vlm';
}

export function ProcessGuideDialog({
  open,
  onOpenChange,
  pipeline,
}: ProcessGuideDialogProps) {
  const lang = useBrowserLanguage();
  const t = TEXT[lang];
  const isVlm = pipeline === 'vlm';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-600" />
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Estimated time */}
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="text-sm">
              {renderBold(isVlm ? t.timeVlm : t.timeStandard)}
            </div>
          </div>

          {/* Browser close notice */}
          <div className="flex items-start gap-3 rounded-md border p-3">
            <MonitorX className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
            <div className="text-sm">{renderBold(t.browserClose)}</div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>{t.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
