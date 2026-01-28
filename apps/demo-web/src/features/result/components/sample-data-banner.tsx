import { Info } from 'lucide-react';

export function SampleDataBanner() {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 text-purple-600" />
        <div>
          <h3 className="font-medium text-purple-900">Sample Data</h3>
          <p className="text-sm text-purple-700">
            This result was processed using the actual engine with real PDF
            documents. It is publicly available for anyone to explore. Upload
            your own PDF to try it yourself.
          </p>
        </div>
      </div>
    </div>
  );
}
