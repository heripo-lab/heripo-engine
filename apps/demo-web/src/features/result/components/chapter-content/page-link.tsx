'use client';

import type { ReactNode } from 'react';

import type { PageType } from '../../utils/page-range-utils';

import { useContentViewer } from '../../contexts/content-viewer-context';

interface PageLinkProps {
  pageNo: number;
  pageType: PageType;
  children?: ReactNode;
  className?: string;
}

export function PageLink({
  pageNo,
  pageType,
  children,
  className,
}: PageLinkProps) {
  const { openPage } = useContentViewer();

  const handleClick = () => {
    openPage(pageNo, pageType);
  };

  const defaultLabel =
    pageType === 'pdf' ? `PDF Page ${pageNo}` : `Page ${pageNo}`;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-primary hover:text-primary/80 cursor-pointer hover:underline ${className ?? ''}`}
    >
      {children ?? defaultLabel}
    </button>
  );
}
