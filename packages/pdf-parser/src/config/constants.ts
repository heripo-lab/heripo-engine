/**
 * Configuration constants for PDFParser
 */
export const PDF_PARSER = {
  /**
   * Default timeout for API calls in milliseconds
   */
  DEFAULT_TIMEOUT_MS: 100000,

  /**
   * Maximum number of health check attempts before giving up
   */
  MAX_HEALTH_CHECK_ATTEMPTS: 60,

  /**
   * Interval between health check attempts in milliseconds
   */
  HEALTH_CHECK_INTERVAL_MS: 2000,

  /**
   * Interval between log messages during health check in milliseconds
   */
  HEALTH_CHECK_LOG_INTERVAL_MS: 5000,

  /**
   * Maximum retry attempts for server recovery on ECONNREFUSED
   */
  MAX_SERVER_RECOVERY_ATTEMPTS: 1,
} as const;

/**
 * Configuration constants for PDFConverter
 */
export const PDF_CONVERTER = {
  /**
   * Interval for progress polling in milliseconds
   */
  POLL_INTERVAL_MS: 1000,
} as const;

/**
 * Configuration constants for DoclingEnvironment
 */
export const DOCLING_ENVIRONMENT = {
  /**
   * Delay after starting docling-serve to allow startup
   */
  STARTUP_DELAY_MS: 2000,
} as const;

/**
 * Configuration constants for ImagePdfConverter
 */
export const IMAGE_PDF_CONVERTER = {
  /**
   * ImageMagick density option (DPI) for PDF to image conversion
   */
  DENSITY: 300,

  /**
   * ImageMagick quality option (1-100)
   */
  QUALITY: 100,
} as const;
