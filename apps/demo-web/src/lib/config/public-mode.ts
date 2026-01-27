export const publicModeConfig = {
  isPublicMode: process.env.NEXT_PUBLIC_PUBLIC_MODE === 'true',
  isOfficialDemo: process.env.NEXT_PUBLIC_HERIPO_OFFICIAL_DEMO === 'true',
  gaMeasurementId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || null,
};

export const sampleTaskConfig = {
  allowDeletion: process.env.NEXT_PUBLIC_ALLOW_SAMPLE_DELETION === 'true',
};
