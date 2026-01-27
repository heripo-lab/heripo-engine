import { existsSync, rmSync } from 'fs';

import {
  deleteUploadSession,
  getExpiredUploadSessions,
  updateUploadSessionStatus,
} from '~/lib/db/repositories/upload-session-repository';
import { paths } from '~/lib/paths';

export interface CleanupResult {
  cleanedCount: number;
  errors: Array<{ uploadId: string; error: string }>;
}

export function cleanupExpiredUploadSessions(): CleanupResult {
  const result: CleanupResult = {
    cleanedCount: 0,
    errors: [],
  };

  const expiredSessions = getExpiredUploadSessions();

  for (const session of expiredSessions) {
    try {
      // Mark as expired
      updateUploadSessionStatus(session.id, 'expired');

      // Clean up chunk directory
      const uploadPaths = paths.upload(session.id);
      if (existsSync(uploadPaths.root)) {
        rmSync(uploadPaths.root, { recursive: true, force: true });
      }

      // Delete session record
      deleteUploadSession(session.id);

      result.cleanedCount++;
    } catch (error) {
      result.errors.push({
        uploadId: session.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return result;
}
