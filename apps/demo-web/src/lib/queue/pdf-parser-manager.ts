import type { LoggerMethods } from '@heripo/logger';

import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';

import { TaskQueueManager } from './task-queue-manager';

const PDF_PARSER_PORT = parseInt(process.env.PDF_PARSER_PORT || '5001', 10);
const PDF_PARSER_TIMEOUT = parseInt(
  process.env.PDF_PARSER_TIMEOUT || '10000000',
  10,
);

class PDFParserManager {
  private static instance: PDFParserManager | null = null;
  private parser: PDFParser | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  private isShuttingDown = false;

  // Task-specific loggers for forwarding PDF parser logs to frontend
  private taskLoggers: Map<string, LoggerMethods> = new Map();

  private constructor() {
    this.setupShutdownHandlers();
  }

  static getInstance(): PDFParserManager {
    if (!PDFParserManager.instance) {
      PDFParserManager.instance = new PDFParserManager();
    }
    return PDFParserManager.instance;
  }

  /**
   * Set a task-specific logger to receive PDF parser logs
   */
  setTaskLogger(taskId: string, logger: LoggerMethods): void {
    this.taskLoggers.set(taskId, logger);
  }

  /**
   * Clear a task-specific logger
   */
  clearTaskLogger(taskId: string): void {
    this.taskLoggers.delete(taskId);
  }

  async getParser(): Promise<PDFParser> {
    if (this.isShuttingDown) {
      throw new Error('PDFParser is shutting down');
    }

    if (this.parser && this.initialized) {
      return this.parser;
    }

    if (this.initPromise) {
      await this.initPromise;
      if (!this.initialized) {
        throw new Error('PDFParser initialization failed');
      }
      return this.parser!;
    }

    this.initPromise = this.initialize();
    await this.initPromise;
    return this.parser!;
  }

  private async initialize(): Promise<void> {
    // Create a logger that forwards to both console and task loggers
    const forwardToTaskLoggers = (
      level: 'debug' | 'info' | 'warn' | 'error',
      ...args: unknown[]
    ) => {
      // Forward to all active task loggers
      for (const taskLogger of this.taskLoggers.values()) {
        taskLogger[level](...args);
      }
    };

    const logger = new Logger({
      debug: (...args) => {
        console.debug(...args);
        forwardToTaskLoggers('debug', ...args);
      },
      info: (...args) => {
        console.info(...args);
        forwardToTaskLoggers('info', ...args);
      },
      warn: (...args) => {
        console.warn(...args);
        forwardToTaskLoggers('warn', ...args);
      },
      error: (...args) => {
        console.error(...args);
        forwardToTaskLoggers('error', ...args);
      },
    });

    logger.info('[PDFParserManager] Initializing PDFParser...');

    try {
      this.parser = new PDFParser({
        logger,
        port: PDF_PARSER_PORT,
        timeout: PDF_PARSER_TIMEOUT,
        killExistingProcess: false,
        enableImagePdfFallback: true,
      });

      await this.parser.init();

      this.initialized = true;
      logger.info('[PDFParserManager] PDFParser initialized successfully');
    } catch (error) {
      this.parser = null;
      this.initPromise = null;
      this.initialized = false;
      logger.error(
        '[PDFParserManager] PDFParser initialization failed:',
        error,
      );
      throw error;
    }
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;

      // Check if there are tasks in queue or running
      const queueManager = TaskQueueManager.getInstance();
      const status = queueManager.getStatus();

      if (status.queueLength > 0 || status.activeCount > 0) {
        console.warn(
          `[PDFParserManager] Cannot shutdown: ${status.activeCount} active tasks, ${status.queueLength} queued tasks`,
        );
        return;
      }

      this.isShuttingDown = true;

      console.log('[PDFParserManager] Shutting down...');
      if (this.parser) {
        await this.parser.dispose();
        this.parser = null;
      }
      console.log('[PDFParserManager] Shutdown complete');
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  isReady(): boolean {
    return this.initialized && this.parser !== null && !this.isShuttingDown;
  }

  isInitializing(): boolean {
    return this.initPromise !== null && !this.initialized;
  }
}

export { PDFParserManager };
