'use client';

import type { ReactNode } from 'react';

import {
  AlertTriangle,
  Bug,
  Cookie,
  Download,
  Fingerprint,
  Server,
  Shield,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Turnstile from 'react-turnstile';

import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';

interface ConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (turnstileToken?: string) => void;
  isPending?: boolean;
  isPublicMode?: boolean;
  isOfficialDemo?: boolean;
}

export function ConsentDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  isPublicMode = false,
  isOfficialDemo = false,
}: ConsentDialogProps) {
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string>('');
  const [renderTurnstile, setRenderTurnstile] = useState(false);

  useEffect(() => {
    if (open) {
      setAgreed(false);
      setTurnstileToken('');
    }
  }, [open]);

  useEffect(() => {
    setRenderTurnstile(true);
  }, []);

  const handleConfirm = () => {
    if (agreed && (!isPublicMode || turnstileToken)) {
      onConfirm(turnstileToken || undefined);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setAgreed(false);
      setTurnstileToken('');
    }
    onOpenChange(newOpen);
  };

  const isConfirmDisabled =
    !agreed || isPending || (isPublicMode && !turnstileToken);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Important Notice
          </DialogTitle>
          <DialogDescription>
            Please read and acknowledge the following information before
            proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <div className="from-background pointer-events-none absolute top-0 right-0 left-0 z-10 h-8 bg-linear-to-b to-transparent" />
          <div className="max-h-[40vh] space-y-3 overflow-y-auto py-4">
            {isPublicMode && (
              <NoticeItem
                icon={<Server className="h-4 w-4" />}
                title="Server Storage"
                description="Your uploaded file and processing results will be stored on the server. Do not upload files containing sensitive or confidential information."
              />
            )}

            <NoticeItem
              icon={<Trash2 className="h-4 w-4" />}
              title="Deletion Available"
              description="You can delete your tasks and results anytime from the Tasks page."
            />

            <NoticeItem
              icon={<Shield className="h-4 w-4" />}
              title="Session-Based Access"
              description="Tasks and results are only accessible and deletable from this browser session."
            />

            {isPublicMode && (
              <NoticeItem
                icon={<Fingerprint className="h-4 w-4" />}
                title="Minimal Data Collection"
                description="We collect your IP address and browser information (User-Agent) solely for security purposes, such as preventing abuse and protecting the system. This data cannot identify you personally, and no other personal information is collected."
              />
            )}

            <NoticeItem
              icon={<Cookie className="h-4 w-4" />}
              title="Cookie Dependency"
              description="Access will be lost if cookies are cleared or expire (1 year validity)."
            />

            {isOfficialDemo && (
              <NoticeItem
                icon={<Server className="h-4 w-4" />}
                title="Automatic Data Deletion"
                description={`Non-sample data is automatically deleted after ${process.env.NEXT_PUBLIC_DATA_RETENTION_DAYS || '7'} days.`}
              />
            )}

            <NoticeItem
              icon={<Download className="h-4 w-4" />}
              title="Download Available"
              description="If you need to keep the results, download them from the result page after processing."
            />

            <NoticeItem
              icon={<Wrench className="h-4 w-4" />}
              title="Work in Progress"
              description="This system is not fully validated for all reports and is continuously being improved. Errors may occur during processing."
            />

            <NoticeItem
              icon={<Bug className="h-4 w-4" />}
              title="Report Issues"
            >
              If you encounter any problems, please report them at{' '}
              <a
                href="https://github.com/heripo-lab/heripo-engine/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:no-underline"
              >
                GitHub Issues
              </a>
              .
            </NoticeItem>
          </div>
          <div className="from-background pointer-events-none absolute right-0 bottom-0 left-0 z-10 h-8 bg-linear-to-t to-transparent" />
        </div>

        <div className="bg-muted/50 flex items-start space-x-3 rounded-md border p-4">
          <Checkbox
            id="consent"
            checked={agreed}
            onCheckedChange={(checked) => setAgreed(checked === true)}
          />
          <label
            htmlFor="consent"
            className="cursor-pointer text-sm leading-relaxed"
          >
            I have read and understood the above information, and I agree to
            proceed with the processing.
          </label>
        </div>

        {isPublicMode && renderTurnstile && (
          <div className="flex justify-center">
            <Turnstile
              sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
              onVerify={(token) => setTurnstileToken(token)}
              onExpire={() => setTurnstileToken('')}
              onError={() => setTurnstileToken('')}
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isConfirmDisabled}>
            {isPending ? 'Processing...' : 'Confirm & Start'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NoticeItemProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
}

function NoticeItem({ icon, title, description, children }: NoticeItemProps) {
  return (
    <div className="flex gap-3">
      <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
        {children && (
          <p className="text-muted-foreground text-sm">{children}</p>
        )}
      </div>
    </div>
  );
}
