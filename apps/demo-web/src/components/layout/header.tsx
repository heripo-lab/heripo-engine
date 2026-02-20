'use client';

import githubIcon from '~/assets/github.svg';
import logoIcon from '~/assets/logo.svg';

import { Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '~/components/ui/button';
import { LinkButton } from '~/components/ui/link-button';

export function Header() {
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <header className="border-border/40 bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur">
      <div className="container mx-auto flex h-14 max-w-screen-xl items-center px-4 xl:px-0">
        <div className="mr-4 flex">
          <Link href="/" className="flex items-center space-x-2">
            <Image src={logoIcon} alt="heripo engine" width={24} height={24} />
            <span className="font-bold">heripo engine</span>
          </Link>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <a
              href="https://github.com/heripo-lab/heripo-engine/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-muted text-muted-foreground hover:bg-muted/80 ml-2 rounded-full px-2 py-0.5 text-xs"
            >
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </a>
          )}
        </div>
        <nav className="flex items-center">
          <LinkButton href="/tasks" variant="ghost" size="sm">
            Tasks
          </LinkButton>
        </nav>
        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center gap-2">
            {!isHome && (
              <LinkButton href="/" variant="default" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                New
              </LinkButton>
            )}
            <Button variant="ghost" size="icon" asChild>
              <a
                href="https://github.com/heripo-lab/heripo-engine"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Image src={githubIcon} alt="GitHub" width={16} height={16} />
              </a>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
