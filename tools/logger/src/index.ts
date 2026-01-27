type LogFn = (...args: any[]) => void;

interface LoggerMethods {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

class Logger implements LoggerMethods {
  public readonly debug: LogFn;
  public readonly info: LogFn;
  public readonly warn: LogFn;
  public readonly error: LogFn;

  constructor(methods: LoggerMethods) {
    this.debug = methods.debug;
    this.info = methods.info;
    this.warn = methods.warn;
    this.error = methods.error;
  }
}

export { Logger };
export type { LoggerMethods, LogFn };
