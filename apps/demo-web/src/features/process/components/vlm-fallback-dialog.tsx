'use client';

import { AlertTriangle, Clock, MonitorX } from 'lucide-react';

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
    title: 'VLM 파이프라인으로 전환',
    description:
      'OCR 결과의 한자 품질이 부족하여 VLM 파이프라인으로 자동 전환되었습니다.',
    timeWarning:
      'VLM 파이프라인은 각 페이지를 비전 모델로 재분석하므로 {{bold}}1시간 이상{{/bold}} 추가 소요될 수 있습니다. 진행률이 초기화된 것은 정상입니다.',
    browserClose:
      '브라우저를 닫거나 페이지를 떠나도 {{bold}}서버에서 처리가 계속{{/bold}}됩니다. 에러 메시지가 없다면 정상적으로 진행 중입니다.',
    confirm: '확인',
  },
  en: {
    title: 'Switched to VLM Pipeline',
    description:
      'Automatically switched to VLM pipeline due to insufficient Korean-Hanja mix quality in OCR results.',
    timeWarning:
      'The VLM pipeline re-analyzes each page with a vision model, which may take {{bold}}over 1 hour{{/bold}} additionally. The progress reset is expected.',
    browserClose:
      'Processing {{bold}}continues on the server{{/bold}} even if you close the browser. If there is no error message, processing is running normally.',
    confirm: 'OK',
  },
} as const;

function renderBold(template: string) {
  const parts = template.split(/\{\{bold\}\}|\{\{\/bold\}\}/);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

interface VlmFallbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VlmFallbackDialog({
  open,
  onOpenChange,
}: VlmFallbackDialogProps) {
  const lang = useBrowserLanguage();
  const t = TEXT[lang];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Extended time warning */}
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="text-sm text-amber-800">
              {renderBold(t.timeWarning)}
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
