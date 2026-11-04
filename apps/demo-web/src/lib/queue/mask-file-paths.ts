// A path ends at whitespace, quotes, or the delimiters that surround it in JSON
// and log text, so structured logs keep their other fields.
const PATH_CHARS = String.raw`[^\s"'\x60,;()\[\]{}<>]`;

const FILE_URL = new RegExp(String.raw`file://${PATH_CHARS}+`, 'g');

// Absolute paths under common roots (/Users, /opt for the deployed app, /tmp, ...).
// The root must be followed by `/`, so text such as `ocr_options` or `/api/...` is kept.
const ABSOLUTE_PATH = new RegExp(
  String.raw`/(?:Users|opt|private|var|tmp|home|Library|Volumes)(?=/)${PATH_CHARS}*`,
  'g',
);

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || '[path]';
}

/**
 * Replace server file paths in a message shown to the public with their last
 * segment, so the UI keeps the useful file name without the server layout.
 */
export function maskFilePaths(message: string): string {
  return message.replace(FILE_URL, basename).replace(ABSOLUTE_PATH, basename);
}
