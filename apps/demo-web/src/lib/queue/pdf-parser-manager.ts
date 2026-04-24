import type { LoggerMethods } from '@heripo/logger';

import { Logger } from '@heripo/logger';
import { PDFParser } from '@heripo/pdf-parser';
import { AsyncLocalStorage } from 'node:async_hooks';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { TaskQueueManager } from './task-queue-manager';

const PDF_PARSER_PORT = parseInt(process.env.PDF_PARSER_PORT || '5001', 10);
const PDF_PARSER_TIMEOUT = parseInt(
  process.env.PDF_PARSER_TIMEOUT || '10000000',
  10,
);
const PDF_PARSER_VENV_PATH =
  process.env.PDF_PARSER_VENV_PATH ||
  join(homedir(), '.heripo', 'pdf-parser-venv');

type PDFParserStatus =
  | 'ready'
  | 'initializing'
  | 'not_initialized'
  | 'unhealthy'
  | 'shutting_down';

class PDFParserManager {
  private static instance: PDFParserManager | null = null;
  private parser: PDFParser | null = null;
  private initPromise: Promise<void> | null = null;
  private readinessPromise: Promise<void> | null = null;
  private initialized = false;
  private isShuttingDown = false;

  // Task-specific loggers for forwarding PDF parser logs to frontend
  private taskLoggers: Map<string, LoggerMethods> = new Map();
  private taskContext = new AsyncLocalStorage<string>();

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

  /**
   * Run a function within a task context so PDF parser logs are forwarded
   * only to the logger registered for this task.
   */
  runInTaskContext<T>(taskId: string, fn: () => T): T {
    return this.taskContext.run(taskId, fn);
  }

  async getParser(): Promise<PDFParser> {
    if (this.isShuttingDown) {
      throw new Error('PDFParser is shutting down');
    }

    if (this.parser && this.initialized) {
      await this.ensureCachedParserReady();
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
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }

    if (!this.parser || !this.initialized) {
      throw new Error('PDFParser initialization failed');
    }

    return this.parser!;
  }

  private async ensureCachedParserReady(): Promise<void> {
    if (!this.parser || !this.initialized) {
      return;
    }

    if (!this.readinessPromise) {
      const parser = this.parser;
      this.readinessPromise = parser
        .ensureReady()
        .catch(async (error: unknown) => {
          this.initialized = false;
          this.parser = null;
          try {
            await parser.dispose();
          } catch (disposeError) {
            console.error(
              '[PDFParserManager] Failed to dispose unhealthy parser:',
              disposeError,
            );
          }
          throw error;
        })
        .finally(() => {
          this.readinessPromise = null;
        });
    }

    await this.readinessPromise;
  }

  private async initialize(): Promise<void> {
    // Create a logger that forwards to both console and task loggers
    const forwardToTaskLoggers = (
      level: 'debug' | 'info' | 'warn' | 'error',
      ...args: unknown[]
    ) => {
      const currentTaskId = this.taskContext.getStore();
      if (currentTaskId) {
        const taskLogger = this.taskLoggers.get(currentTaskId);
        if (taskLogger) {
          taskLogger[level](...args);
        }
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
    logger.info(
      '[PDFParserManager] Using PDFParser venv:',
      PDF_PARSER_VENV_PATH,
    );

    try {
      this.parser = new PDFParser({
        logger,
        port: PDF_PARSER_PORT,
        timeout: PDF_PARSER_TIMEOUT,
        venvPath: PDF_PARSER_VENV_PATH,
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

  async getStatus(): Promise<PDFParserStatus> {
    if (this.isShuttingDown) {
      return 'shutting_down';
    }

    if (this.initPromise && !this.initialized) {
      return 'initializing';
    }

    if (!this.parser || !this.initialized) {
      return 'not_initialized';
    }

    return (await this.parser.isReady()) ? 'ready' : 'unhealthy';
  }
}

export { PDFParserManager };
