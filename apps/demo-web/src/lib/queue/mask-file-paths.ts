// Common server roots (/Users, /opt for the deployed app, /tmp, ...). A root must be
// followed by `/`, so text such as `ocr_options` or `/api/...` is kept.
const ROOTS = '(?:Users|opt|private|var|tmp|home|Library|Volumes)';

// An unquoted path ends at whitespace, quotes, or the delimiters around it in
// JSON and log text, so structured logs keep their other fields.
const PATH_CHARS = String.raw`[^\s"'\x60,;()\[\]{}<>]`;

const PATTERN = new RegExp(
  [
    // 1: web URL, kept as is even when its path contains a root name
    String.raw`(https?://[^\s"'\x60<>]+)`,
    // 2-3: quoted path, which may contain spaces ("/Volumes/My Drive/a.pdf")
    String.raw`(["'\x60])((?:file://)?/${ROOTS}/[^"'\x60\n]*)\2`,
    // file:// URL
    String.raw`file://${PATH_CHARS}+`,
    // unquoted absolute path that is not part of a host or relative path
    String.raw`(?<![\w.~-])/${ROOTS}(?=/)${PATH_CHARS}*`,
  ].join('|'),
  'g',
);

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || '[path]';
}

/**
 * Replace server file paths in a message shown to the public with their last
 * segment, so the UI keeps the useful file name without the server layout.
 * Unquoted paths that contain spaces can only be masked up to the first space.
 */
export function maskFilePaths(message: string): string {
  return message.replace(
    PATTERN,
    (match, url?: string, quote?: string, quotedPath?: string) => {
      if (url) return url;
      if (quote && quotedPath) return `${quote}${basename(quotedPath)}${quote}`;
      return basename(match);
    },
  );
}
