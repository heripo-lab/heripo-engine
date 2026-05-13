import { ExternalLink, Heart } from 'lucide-react';
import Link from 'next/link';

import { publicModeConfig } from '~/lib/config/public-mode';

import { Button } from '~/components/ui/button';

const sponsorLinks = [
  {
    href: 'https://opencollective.com/heripo-project',
    label: 'Open Collective',
    ariaLabel: 'Sponsor heripo lab on Open Collective',
  },
  {
    href: 'https://fairy.hada.io/@heripo',
    label: 'fairy.hada.io/@heripo',
    ariaLabel: 'Sponsor heripo lab through fairy.hada.io',
  },
] as const;

const copyrightYear = (() => {
  const startYear = 2026; // The year the project started
  const currentYear = new Date().getFullYear();

  if (currentYear < startYear + 1) {
    return `${currentYear}`;
  }

  return `${startYear}-${currentYear}`;
})();

export function Footer() {
  return (
    <footer className="border-t">
      <div className="container mx-auto flex max-w-screen-xl flex-col gap-4 px-4 py-5 xl:px-0">
        <section
          aria-label="Sponsorship"
          className="flex flex-col items-center justify-between gap-3 md:flex-row"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Heart
              className="h-4 w-4 fill-rose-500 text-rose-500"
              aria-hidden="true"
            />
            <span>Sponsor heripo lab</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {sponsorLinks.map((sponsor) => (
              <Button key={sponsor.href} variant="outline" size="sm" asChild>
                <a
                  href={sponsor.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={sponsor.ariaLabel}
                >
                  {sponsor.label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </Button>
            ))}
          </div>
        </section>

        <div className="border-border/60 flex flex-col items-center justify-between gap-3 border-t pt-4 md:flex-row">
          <p className="text-muted-foreground text-sm">
            © {copyrightYear} heripo lab. All rights reserved.
          </p>
          <p className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-1 text-sm md:justify-end">
            <span>Apache-2.0</span>
            <span>|</span>
            <a
              href="https://github.com/heripo-lab/heripo-engine"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline underline-offset-4"
            >
              GitHub
            </a>
            {process.env.NEXT_PUBLIC_APP_VERSION && (
              <>
                <span>|</span>
                <a
                  href="https://github.com/heripo-lab/heripo-engine/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground underline underline-offset-4"
                >
                  v{process.env.NEXT_PUBLIC_APP_VERSION} Releases
                </a>
              </>
            )}
            {publicModeConfig.isOfficialDemo && (
              <>
                <span>|</span>
                <Link
                  href="/legal/terms"
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Terms
                </Link>
                <span>|</span>
                <Link
                  href="/legal/privacy"
                  className="hover:text-foreground underline underline-offset-4"
                >
                  Privacy
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </footer>
  );
}
