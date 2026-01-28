'use client';

import { AlertTriangle, FileCheck, FileQuestion, ImageOff } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

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
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Before You Upload
          </DialogTitle>
          <DialogDescription>
            Please review the following information before uploading your PDF.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
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
