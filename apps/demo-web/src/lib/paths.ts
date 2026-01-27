import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');
const TASKS_DIR = join(DATA_DIR, 'tasks');
const UPLOADS_DIR = join(DATA_DIR, 'uploads');
const OUTPUT_DIR = join(process.cwd(), 'output');

export const paths = {
  dataDir: DATA_DIR,
  tasksDir: TASKS_DIR,
  uploadsDir: UPLOADS_DIR,
  outputDir: OUTPUT_DIR,
  database: join(DATA_DIR, 'heripo.db'),

  task: (taskId: string) => ({
    root: join(TASKS_DIR, taskId),
    outputRoot: join(OUTPUT_DIR, taskId),
    inputPdf: join(TASKS_DIR, taskId, 'input.pdf'),
    resultJson: join(TASKS_DIR, taskId, 'result.json'),
    processedJson: join(TASKS_DIR, taskId, 'result-processed.json'),
    imagesDir: join(TASKS_DIR, taskId, 'images'),
    pagesDir: join(TASKS_DIR, taskId, 'pages'),
    image: (index: number) =>
      join(TASKS_DIR, taskId, 'images', `image_${index}.png`),
    page: (index: number) =>
      join(TASKS_DIR, taskId, 'pages', `page_${index}.png`),
  }),

  upload: (uploadId: string) => ({
    root: join(UPLOADS_DIR, uploadId),
    chunksDir: join(UPLOADS_DIR, uploadId, 'chunks'),
    mergedPdf: join(UPLOADS_DIR, uploadId, 'merged.pdf'),
    chunk: (index: number) =>
      join(
        UPLOADS_DIR,
        uploadId,
        'chunks',
        `chunk_${index.toString().padStart(5, '0')}`,
      ),
  }),
};
