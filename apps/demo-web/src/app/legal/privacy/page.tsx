import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { publicModeConfig } from '~/lib/config/public-mode';

export const metadata: Metadata = {
  title: 'Privacy Policy - heripo engine',
};

export default function PrivacyPolicyPage() {
  if (!publicModeConfig.isOfficialDemo) {
    notFound();
  }

  return (
    <main className="container mx-auto max-w-screen-md px-4 py-12">
      <h1 className="mb-8 text-3xl font-bold">Privacy Policy</h1>
      <p className="text-muted-foreground mb-8 text-sm">
        Last updated: January 28, 2026
      </p>

      <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
        {/* Article 1: Purpose of Processing */}
        <section>
          <h2 className="text-xl font-semibold">
            1. Purpose of Processing Personal Information
          </h2>
          <p className="text-muted-foreground mt-2">
            This Demo service (&quot;Service&quot;) processes personal
            information for the following purposes. The personal information we
            collect will only be used for these purposes, and we will seek your
            consent prior to any change in purpose.
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>PDF Processing Service:</strong> To convert and analyze
              uploaded PDF documents
            </li>
            <li>
              <strong>Rate Limiting:</strong> To enforce usage limits and
              prevent abuse of the service
            </li>
            <li>
              <strong>Service Analytics:</strong> To understand usage patterns
              and improve the service (anonymized)
            </li>
            <li>
              <strong>Security:</strong> To protect the service and its users
              from malicious activities
            </li>
          </ul>
        </section>

        {/* Article 2: Information We Collect */}
        <section>
          <h2 className="text-xl font-semibold">
            2. Information We Collect and Retention Period
          </h2>
          <p className="text-muted-foreground mt-2">
            We collect the following categories of information:
          </p>

          <h3 className="mt-4 text-lg font-medium">
            2.1 Information You Provide
          </h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Uploaded PDF Files:</strong> Documents you upload for
              processing (retained temporarily during processing, then deleted)
            </li>
          </ul>

          <h3 className="mt-4 text-lg font-medium">
            2.2 Automatically Collected Information
          </h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>IP Address:</strong> For rate limiting and security
              (retained for the duration of the daily rate limit period)
            </li>
            <li>
              <strong>Device and Browser Information:</strong> User agent,
              screen resolution (collected via analytics)
            </li>
            <li>
              <strong>Usage Data:</strong> Pages visited, features used,
              timestamps (anonymized via Google Analytics)
            </li>
            <li>
              <strong>Cookies:</strong> Essential cookies for service operation
              and analytics cookies (see Section 10)
            </li>
          </ul>
        </section>

        {/* Article 3: Retention Period */}
        <section>
          <h2 className="text-xl font-semibold">3. Data Retention Period</h2>
          <p className="text-muted-foreground mt-2">
            As a demo service, we maintain a minimal data retention approach:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Uploaded Files:</strong> Deleted immediately after
              processing is complete, or within 24 hours at the latest
            </li>
            <li>
              <strong>Processing Results:</strong> Stored temporarily during
              your session, subject to daily cleanup
            </li>
            <li>
              <strong>IP-based Rate Limit Data:</strong> Reset every 24 hours
            </li>
            <li>
              <strong>Analytics Data:</strong> Retained by Google Analytics
              according to their data retention settings (anonymized)
            </li>
          </ul>
        </section>

        {/* Article 4: Disclosure to Third Parties */}
        <section>
          <h2 className="text-xl font-semibold">
            4. Disclosure of Information to Third Parties
          </h2>
          <p className="text-muted-foreground mt-2">
            We do not sell, trade, or otherwise transfer your personal
            information to third parties. Your information may be disclosed only
            in the following circumstances:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Legal Requirements:</strong> When required by law, court
              order, or governmental authority
            </li>
            <li>
              <strong>Service Protection:</strong> To protect the rights,
              property, or safety of the Service, its users, or the public
            </li>
            <li>
              <strong>With Your Consent:</strong> When you have provided
              explicit consent for disclosure
            </li>
          </ul>
        </section>

        {/* Article 5: Processing Delegation */}
        <section>
          <h2 className="text-xl font-semibold">
            5. Delegation of Personal Information Processing
          </h2>
          <p className="text-muted-foreground mt-2">
            We delegate certain aspects of data processing to the following
            third-party service providers:
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="text-muted-foreground min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-4 py-2 text-left font-medium">
                    Service Provider
                  </th>
                  <th className="px-4 py-2 text-left font-medium">
                    Delegated Tasks
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="px-4 py-2">Google Analytics</td>
                  <td className="px-4 py-2">
                    Website usage analytics (anonymized)
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2">OpenAI, Google AI, Together.ai</td>
                  <td className="px-4 py-2">
                    Document content analysis and processing via LLM
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-4 py-2">Cloudflare</td>
                  <td className="px-4 py-2">
                    Security, DDoS protection, and CDN services
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground mt-4">
            These service providers are contractually bound to protect your
            information and use it only for the specified purposes.
          </p>
        </section>

        {/* Article 6: International Data Transfer */}
        <section>
          <h2 className="text-xl font-semibold">
            6. International Transfer of Personal Information
          </h2>
          <p className="text-muted-foreground mt-2">
            Your information may be transferred to and processed in countries
            other than your own. Specifically:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>LLM Processing:</strong> Document content sent to LLM
              providers (OpenAI, Google AI, Together.ai) may be processed in the
              United States or other countries where these providers operate
            </li>
            <li>
              <strong>Analytics:</strong> Google Analytics data may be processed
              globally in accordance with Google&apos;s data processing
              practices
            </li>
            <li>
              <strong>CDN/Security:</strong> Cloudflare may process data across
              their global network
            </li>
          </ul>
          <p className="text-muted-foreground mt-4">
            By using this Service, you consent to the transfer of your
            information to these countries, which may have different data
            protection laws than your country of residence.
          </p>
        </section>

        {/* Article 7: Your Rights */}
        <section>
          <h2 className="text-xl font-semibold">
            7. Your Rights Regarding Personal Information
          </h2>
          <p className="text-muted-foreground mt-2">
            You have the following rights regarding your personal information:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Right to Access:</strong> Request information about what
              data we have collected about you
            </li>
            <li>
              <strong>Right to Deletion:</strong> Request deletion of your
              personal information
            </li>
            <li>
              <strong>Right to Rectification:</strong> Request correction of
              inaccurate information
            </li>
            <li>
              <strong>Right to Object:</strong> Object to certain types of
              processing
            </li>
            <li>
              <strong>Right to Data Portability:</strong> Request a copy of your
              data in a portable format
            </li>
          </ul>
          <p className="text-muted-foreground mt-4">
            <strong>Note:</strong> Due to the temporary nature of this demo
            service and the minimal data retention, there may be limited data
            available for access or deletion requests. We do not maintain
            persistent user accounts.
          </p>
          <p className="text-muted-foreground mt-2">
            To exercise these rights, please contact us at{' '}
            <a
              href="mailto:privacy@heripo.com"
              className="text-foreground underline underline-offset-4"
            >
              privacy@heripo.com
            </a>
            .
          </p>
        </section>

        {/* Article 8: Data Destruction */}
        <section>
          <h2 className="text-xl font-semibold">
            8. Destruction of Personal Information
          </h2>
          <p className="text-muted-foreground mt-2">
            We destroy personal information when it is no longer necessary for
            the purposes for which it was collected:
          </p>
          <h3 className="mt-4 text-lg font-medium">8.1 Destruction Timing</h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>Uploaded files: Immediately after processing completion</li>
            <li>Processing results: During daily automated cleanup</li>
            <li>Rate limit data: Automatically reset every 24 hours</li>
          </ul>
          <h3 className="mt-4 text-lg font-medium">8.2 Destruction Methods</h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Electronic Files:</strong> Permanently deleted using
              secure deletion methods
            </li>
            <li>
              <strong>Database Records:</strong> Removed from database with no
              backup retention
            </li>
          </ul>
        </section>

        {/* Article 9: Security Measures */}
        <section>
          <h2 className="text-xl font-semibold">
            9. Measures to Ensure Security of Personal Information
          </h2>
          <p className="text-muted-foreground mt-2">
            We implement the following security measures to protect your
            personal information:
          </p>
          <h3 className="mt-4 text-lg font-medium">9.1 Technical Safeguards</h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>HTTPS encryption for all data transmission</li>
            <li>Secure file storage with access controls</li>
            <li>DDoS protection via Cloudflare</li>
            <li>Rate limiting to prevent abuse</li>
            <li>Regular security updates and patches</li>
          </ul>
          <h3 className="mt-4 text-lg font-medium">
            9.2 Administrative Safeguards
          </h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              Limited access to personal information on a need-to-know basis
            </li>
            <li>Regular review of security practices</li>
            <li>Incident response procedures for data breaches</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            <strong>Important:</strong> No method of transmission over the
            Internet or electronic storage is 100% secure. Please do not upload
            sensitive, confidential, or personally identifiable documents to
            this demo service.
          </p>
        </section>

        {/* Article 10: Cookies */}
        <section>
          <h2 className="text-xl font-semibold">
            10. Cookies and Tracking Technologies
          </h2>
          <p className="text-muted-foreground mt-2">
            This Service uses cookies and similar tracking technologies:
          </p>
          <h3 className="mt-4 text-lg font-medium">10.1 Types of Cookies</h3>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              <strong>Essential Cookies:</strong> Required for the Service to
              function properly (session management, security)
            </li>
            <li>
              <strong>Analytics Cookies:</strong> Used by Google Analytics to
              understand how visitors interact with the Service
            </li>
          </ul>
          <h3 className="mt-4 text-lg font-medium">
            10.2 Managing Cookie Preferences
          </h3>
          <p className="text-muted-foreground mt-2">
            You can control cookies through your browser settings:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              Most browsers allow you to refuse or delete cookies through their
              settings menu
            </li>
            <li>
              You can opt out of Google Analytics by installing the{' '}
              <a
                href="https://tools.google.com/dlpage/gaoptout"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                Google Analytics Opt-out Browser Add-on
              </a>
            </li>
            <li>
              Disabling essential cookies may affect the functionality of the
              Service
            </li>
          </ul>
        </section>

        {/* Article 11: Contact Information */}
        <section>
          <h2 className="text-xl font-semibold">
            11. Personal Information Protection Officer
          </h2>
          <p className="text-muted-foreground mt-2">
            For privacy-related inquiries, complaints, or to exercise your
            rights, please contact:
          </p>
          <div className="bg-muted mt-4 rounded-lg p-4">
            <p className="text-muted-foreground">
              <strong>Data Protection Officer:</strong> Kim Hongyeon
              <br />
              <strong>Data Handlers:</strong> Kim Hongyeon, Cho Hayoung
              <br />
              <strong>Email:</strong>{' '}
              <a
                href="mailto:privacy@heripo.com"
                className="text-foreground underline underline-offset-4"
              >
                privacy@heripo.com
              </a>
            </p>
          </div>
          <p className="text-muted-foreground mt-4">
            We will respond to your inquiries within a reasonable timeframe.
          </p>
        </section>

        {/* Article 12: Remedies */}
        <section>
          <h2 className="text-xl font-semibold">
            12. Remedies for Rights Violations
          </h2>
          <p className="text-muted-foreground mt-2">
            If you believe your privacy rights have been violated, you may:
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1">
            <li>
              Contact our Data Protection Officer at{' '}
              <a
                href="mailto:privacy@heripo.com"
                className="text-foreground underline underline-offset-4"
              >
                privacy@heripo.com
              </a>
            </li>
            <li>
              File a complaint with the relevant data protection authority in
              your jurisdiction
            </li>
            <li>
              Seek legal remedies available under applicable data protection
              laws
            </li>
          </ul>
        </section>

        {/* Article 13: Changes to Policy */}
        <section>
          <h2 className="text-xl font-semibold">13. Changes to This Policy</h2>
          <p className="text-muted-foreground mt-2">
            We may update this Privacy Policy from time to time to reflect
            changes in our practices or for legal, operational, or regulatory
            reasons.
          </p>
          <p className="text-muted-foreground mt-4">
            <strong>Important:</strong> As this is a demo service without user
            accounts or email collection, we have no means to notify users of
            policy changes in advance.{' '}
            <strong>
              Any changes to this Privacy Policy will take effect immediately
              upon posting.
            </strong>{' '}
            The &quot;Last updated&quot; date at the top of this page indicates
            when the policy was last revised.
          </p>
          <p className="text-muted-foreground mt-4">
            We encourage you to review this Privacy Policy periodically to stay
            informed about how we are protecting your information.
          </p>
        </section>
      </div>
    </main>
  );
}
