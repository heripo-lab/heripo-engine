import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';

/** A server directory to hide and the text that replaces it. */
export interface MaskedPrefix {
  path: string;
  replacement: string;
}

// Characters that may follow a path. A prefix only matches at a path boundary,
// so /Users/heripo-demo does not match inside /Users/heripo-demo2.
const BOUNDARY = String.raw`(?=$|[/\s"'\x60,;()\[\]{}<>])`;

// Fallback for paths outside the known prefixes: common server roots followed
// by `/`, ending at whitespace, quotes or JSON delimiters. Web URLs and host or
// relative paths are left alone.
const ROOTS = '(?:Users|opt|private|var|tmp|home|Library|Volumes)';
const PATH_CHARS = String.raw`[^\s"'\x60,;()\[\]{}<>]`;
const FALLBACK = new RegExp(
  [
    String.raw`(https?://[^\s"'\x60<>]+)`,
    String.raw`file://${PATH_CHARS}+`,
    String.raw`(?<![\w.~-])/${ROOTS}(?=/)${PATH_CHARS}*`,
  ].join('|'),
  'g',
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || '[path]';
}

/**
 * Builds a masker for messages shown to the public.
 *
 * Known server directories are replaced exactly, so paths under them stay
 * masked whatever they contain (spaces, quotes) and the surrounding text is
 * kept. Other absolute paths are reduced to their last segment on a best-effort
 * basis: an unquoted path with spaces is only masked up to the first space.
 */
export function createPathMasker(
  prefixes: MaskedPrefix[],
): (message: string) => string {
  const known = [
    ...new Map(
      prefixes
        .map((p) => ({ ...p, path: p.path.replace(/\/+$/, '') }))
        .filter((p) => p.path.length > 1)
        .map((p) => [p.path, p]),
    ).values(),
  ].sort((a, b) => b.path.length - a.path.length);

  const knownPattern = known.length
    ? new RegExp(
        `(?:file://)?(?:${known.map((p) => escapeRegExp(p.path)).join('|')})${BOUNDARY}`,
        'g',
      )
    : null;

  return (message) => {
    const masked = knownPattern
      ? message.replace(knownPattern, (match) => {
          const path = match.replace(/^file:\/\//, '');
          return known.find((p) => p.path === path)?.replacement ?? match;
        })
      : message;
    return masked.replace(FALLBACK, (match, url?: string) =>
      url ? url : basename(match),
    );
  };
}

function withRealPath(path: string, replacement: string): MaskedPrefix[] {
  const entries = [{ path, replacement }];
  try {
    entries.push({ path: realpathSync(path), replacement });
  } catch {
    // The directory may not exist yet; the plain path still applies.
  }
  return entries;
}

/** Server directories of this process: app directory, home and temp dir. */
export function defaultMaskedPrefixes(): MaskedPrefix[] {
  return [
    ...withRealPath(process.cwd(), '.'),
    ...withRealPath(homedir(), '~'),
    ...withRealPath(tmpdir(), '<tmp>'),
  ];
}

export const maskFilePaths = createPathMasker(defaultMaskedPrefixes());
