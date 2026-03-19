/**
 * Extract the maximum page number from TOC markdown
 *
 * Parses page numbers from dot-leader patterns (e.g., "..... 175")
 * and table cell patterns (e.g., "| title | 175 |") to detect compiled
 * volume scenarios where TOC page numbers exceed the sub-document's page count.
 *
 * @param markdown - TOC markdown content
 * @returns Maximum page number found, or 0 if none found
 */
export function extractMaxPageNumber(markdown: string): number {
  // Pattern 1: dot-leader format (e.g., "..... 175")
  const dotLeaderMatches = [...markdown.matchAll(/\.{2,}\s*(\d+)/g)];

  // Pattern 2: table last cell (e.g., "| title | 175 |")
  const tableCellMatches = [...markdown.matchAll(/\|\s*(\d+)\s*\|\s*$/gm)];

  const allNumbers = [
    ...dotLeaderMatches.map((m) => parseInt(m[1], 10)),
    ...tableCellMatches.map((m) => parseInt(m[1], 10)),
  ];

  if (allNumbers.length === 0) {
    return 0;
  }
  return Math.max(...allNumbers);
}
