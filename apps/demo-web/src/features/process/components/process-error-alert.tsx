interface ProcessErrorAlertProps {
  error: { code: string; message: string } | undefined;
}

export function ProcessErrorAlert({ error }: ProcessErrorAlertProps) {
  if (!error) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-600">
      <strong>Error:</strong> {error.message}
    </div>
  );
}
