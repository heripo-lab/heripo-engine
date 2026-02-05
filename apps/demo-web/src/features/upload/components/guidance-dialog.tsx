'use client';

import {
  AlertTriangle,
  Construction,
  FileCheck,
  FileQuestion,
  ImageOff,
} from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

import { KNOWN_LIMITATIONS } from '../constants/known-limitations';
import { useBrowserLanguage } from '../hooks/use-browser-language';

interface GuidanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function GuidanceDialog({
  open,
  onOpenChange,
  onConfirm,
}: GuidanceDialogProps) {
  const lang = useBrowserLanguage();
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const limitationsTitle =
    lang === 'ko' ? '알려진 제한사항' : 'Known Limitations';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] max-w-lg flex-col"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Before You Upload
          </DialogTitle>
          <DialogDescription>
            Please review the following information before uploading your PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto py-4">
          <GuidanceItem
            icon={<FileCheck className="h-4 w-4" />}
            title="Complete Report Required"
            description="Missing pages or corrupted table of contents may cause processing errors. Please ensure your PDF contains the complete report."
          />

          <GuidanceItem
            icon={<ImageOff className="h-4 w-4" />}
            title="Document Quality Notice"
            description="Older or low-quality scanned documents are supported, but have not been extensively tested. Processing accuracy may vary."
          />

          <GuidanceItem
            icon={<FileQuestion className="h-4 w-4" />}
            title="Archaeological Reports Recommended"
            description="While any structured PDF can be processed technically, this system is optimized for archaeological excavation reports. Results for other document types are not guaranteed."
          />

          {/* Known Limitations Section */}
          <div className="mt-4 border-t pt-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-700">
              <Construction className="h-4 w-4" />
              {limitationsTitle}
            </p>
            {KNOWN_LIMITATIONS.filter(
              (limitation) => limitation.id !== 'automation-scope',
            ).map((limitation) => (
              <GuidanceItem
                key={limitation.id}
                icon={<Construction className="h-4 w-4" />}
                title={lang === 'ko' ? limitation.titleKo : limitation.titleEn}
                description={
                  lang === 'ko'
                    ? limitation.descriptionKo
                    : limitation.descriptionEn
                }
              />
            ))}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface GuidanceItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function GuidanceItem({ icon, title, description }: GuidanceItemProps) {
  return (
    <div className="flex gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}
