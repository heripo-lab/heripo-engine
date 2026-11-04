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
// by `/`, ending at whitespace, quotes or JSON delimiters.
const ROOTS = '(?:Users|opt|private|var|tmp|home|Library|Volumes)';
const PATH_CHARS = String.raw`[^\s"'\x60,;()\[\]{}<>]`;

// Web URLs are matched first and kept, so neither a known prefix nor the
// fallback rewrites a URL path such as https://example.com/Users/...
const WEB_URL = String.raw`(https?://[^\s"'\x60<>]+)`;

// A path must not continue a host or relative path (example.com/opt/...).
const NOT_AFTER_WORD = String.raw`(?<![\w.~-])`;

const FALLBACK_FILE_URL = String.raw`file://${PATH_CHARS}+`;
const FALLBACK_PATH = String.raw`${NOT_AFTER_WORD}/${ROOTS}(?=/)${PATH_CHARS}*`;

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

  // One pass: at each position a web URL wins, then a known prefix, then the
  // fallback. Capture groups: 1 = web URL, 2 = known prefix.
  // With no known prefixes the group is `(?!)`, which never matches, so the
  // capture group numbers stay the same.
  const knownPaths = known.length
    ? known.map((p) => escapeRegExp(p.path)).join('|')
    : '(?!)';
  const pattern = new RegExp(
    [
      WEB_URL,
      String.raw`${NOT_AFTER_WORD}(?:file://)?(${knownPaths})${BOUNDARY}`,
      FALLBACK_FILE_URL,
      FALLBACK_PATH,
    ].join('|'),
    'g',
  );
  const replacements = new Map(known.map((p) => [p.path, p.replacement]));

  return (message) =>
    message.replace(pattern, (match, url?: string, knownPath?: string) => {
      if (url) return url;
      if (knownPath) return replacements.get(knownPath) ?? match;
      return basename(match);
    });
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
