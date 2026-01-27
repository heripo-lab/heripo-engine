import { Card, CardContent } from '~/components/ui/card';
import { LinkButton } from '~/components/ui/link-button';

interface ResultErrorProps {
  message: string;
}

export function ResultError({ message }: ResultErrorProps) {
  return (
    <div className="container mx-auto py-10">
      <div className="mx-auto max-w-4xl">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-red-600">Error: {message}</p>
            <LinkButton href="/" className="mt-4">
              Go Back
            </LinkButton>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
