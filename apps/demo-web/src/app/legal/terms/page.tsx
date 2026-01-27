import { notFound } from 'next/navigation';

import { publicModeConfig } from '~/lib/config/public-mode';

export default function TermsOfServicePage() {
  if (!publicModeConfig.isOfficialDemo) {
    notFound();
  }

  return (
    <main className="container mx-auto max-w-screen-md px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold">Terms of Service</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Last updated: January 28, 2026
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-xl font-semibold">1. Service Description</h2>
          <p className="text-muted-foreground mt-2">
            This is a demonstration application (&quot;Demo&quot;) for the
            heripo engine, an open-source PDF processing tool for archaeological
            reports. The Demo allows users to upload PDF files and process them
            using OCR and LLM-based document analysis.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">2. Usage Restrictions</h2>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>This Demo is provided for evaluation and demonstration only</li>
            <li>
              Do not upload confidential, sensitive, or personally identifiable
              information
            </li>
            <li>
              Commercial use of this Demo service is not permitted without prior
              written consent
            </li>
            <li>
              Rate limits and usage restrictions may apply to ensure fair access
              for all users
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold">
            3. Data Retention and Deletion
          </h2>
          <p className="text-muted-foreground mt-2">
            User-uploaded files and processing results are automatically deleted
            after {process.env.NEXT_PUBLIC_DATA_RETENTION_DAYS || '7'} days from
            creation. Sample data provided for demonstration purposes is
            retained indefinitely. Users may manually delete their data at any
            time through the Tasks page. We recommend downloading any important
            results before the retention period expires.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">4. Disclaimer of Warranties</h2>
          <p className="text-muted-foreground mt-2">
            THE DEMO IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTY OF ANY KIND,
            EXPRESS OR IMPLIED. We do not guarantee the accuracy, completeness,
            or reliability of any processing results. Uploaded files and
            processing results may be deleted at any time without notice.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">5. Limitation of Liability</h2>
          <p className="text-muted-foreground mt-2">
            To the maximum extent permitted by law, heripo lab shall not be
            liable for any indirect, incidental, special, consequential, or
            punitive damages arising from the use of or inability to use this
            Demo.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">
            6. Intellectual Property & License
          </h2>
          <p className="text-muted-foreground mt-2">
            The heripo engine is open-source software licensed under the
            Apache-2.0 License. You may use, modify, and distribute the software
            in accordance with the license terms. Your uploaded content remains
            your property.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">7. Changes to Terms</h2>
          <p className="text-muted-foreground mt-2">
            We reserve the right to modify these Terms at any time. Continued
            use of the Demo after changes constitutes acceptance of the modified
            Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">8. Governing Law</h2>
          <p className="text-muted-foreground mt-2">
            These Terms shall be governed by and construed in accordance with
            the laws of the Republic of Korea, without regard to its conflict of
            law provisions.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold">9. Contact</h2>
          <p className="text-muted-foreground mt-2">
            For questions about these Terms, please contact us at{' '}
            <a
              href="mailto:contact@heripo.com"
              className="text-foreground underline underline-offset-4"
            >
              contact@heripo.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
