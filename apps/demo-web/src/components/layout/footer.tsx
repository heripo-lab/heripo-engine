import Link from 'next/link';

import { publicModeConfig } from '~/lib/config/public-mode';

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
    <footer className="border-t py-6 md:py-0">
      <div className="container mx-auto flex max-w-screen-xl flex-col items-center justify-between gap-4 px-4 md:h-16 md:flex-row xl:px-0">
        <p className="text-muted-foreground text-sm">
          © {copyrightYear} heripo lab. All rights reserved.
        </p>
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-1 text-sm">
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
    </footer>
  );
}
