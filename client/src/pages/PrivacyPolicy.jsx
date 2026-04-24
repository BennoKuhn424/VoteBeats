import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white dark:bg-dark-950 text-zinc-800 dark:text-zinc-200">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/" className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 text-sm mb-8 inline-block">&larr; Back to Home</Link>

        <h1 className="text-3xl font-bold mb-2 text-zinc-900 dark:text-zinc-100">Privacy Policy</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-8">Last updated: 11 April 2026</p>

        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            SpeelDit ("we", "us", "our") operates the SpeelDit web application at speeldit.com.
            This Privacy Policy explains how we collect, use, and protect your personal information
            in compliance with the Protection of Personal Information Act, 2013 (POPIA) of South Africa.
          </p>

          <h2 className="text-xl font-semibold mt-8">1. Information We Collect</h2>

          <h3 className="text-lg font-medium">Venue Owners (account holders)</h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>Email address and password (hashed, never stored in plain text)</li>
            <li>Venue name and location</li>
            <li>Venue settings and playlist preferences</li>
            <li>Payment transaction records (processed by Yoco; we do not store card details)</li>
          </ul>

          <h3 className="text-lg font-medium">Customers (voters/requesters)</h3>
          <ul className="list-disc pl-6 space-y-1">
            <li>A randomly generated device identifier (stored in your browser's local storage)</li>
            <li>Song votes and requests associated with that device identifier</li>
            <li>Volume feedback submissions</li>
          </ul>
          <p>
            We do <strong>not</strong> collect your name, email, phone number, or any other
            personally identifiable information as a customer. The device identifier cannot
            be used to identify you personally.
          </p>

          <h2 className="text-xl font-semibold mt-8">2. How We Use Your Information</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>To provide and operate the SpeelDit service</li>
            <li>To authenticate venue owners and protect their accounts</li>
            <li>To process song requests and payments</li>
            <li>To display real-time queue and voting data</li>
            <li>To generate analytics for venue owners (song popularity, activity trends)</li>
            <li>To improve our service and fix bugs</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">3. Legal Basis for Processing</h2>
          <p>We process your information based on:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Consent</strong> &mdash; by creating an account or using the voting feature, you consent to the processing described in this policy</li>
            <li><strong>Contractual necessity</strong> &mdash; to provide the service you signed up for</li>
            <li><strong>Legitimate interest</strong> &mdash; to maintain security, prevent fraud, and improve the service</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">4. Cookies and Local Storage</h2>
          <p>We use the following:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>auth_token</strong> (httpOnly cookie) &mdash; authenticates venue owner sessions. Expires after 7 days.</li>
            <li><strong>csrf_token</strong> (cookie) &mdash; protects against cross-site request forgery. Expires after 7 days.</li>
            <li><strong>Device ID</strong> (localStorage) &mdash; a random identifier to track your votes and requests within a venue. No personal data.</li>
            <li><strong>Checkout tracking</strong> (sessionStorage/cookie) &mdash; temporarily stores payment checkout IDs during the payment flow. Expires after 10 minutes.</li>
          </ul>
          <p>We do <strong>not</strong> use third-party tracking cookies, advertising cookies, or analytics cookies.</p>

          <h2 className="text-xl font-semibold mt-8">5. Third-Party Services</h2>
          <p>We share data with the following third parties only as necessary to operate the service:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Yoco</strong> (payments) &mdash; processes card payments for paid song requests. Subject to <a href="https://www.yoco.com/za/legal/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">Yoco's Privacy Policy</a>.</li>
            <li><strong>Apple Music</strong> &mdash; provides song search results and music playback. No personal data is shared with Apple.</li>
            <li><strong>LRCLIB</strong> &mdash; provides song lyrics. No personal data is shared.</li>
            <li><strong>Vercel</strong> (hosting) &mdash; hosts the frontend application.</li>
            <li><strong>Render</strong> (hosting) &mdash; hosts the backend API server.</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">6. Data Retention</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Venue owner accounts and data are kept for as long as the account is active</li>
            <li>Customer device identifiers and vote data are kept for up to 90 days of inactivity</li>
            <li>Payment records are kept for 5 years as required by South African tax law</li>
            <li>Analytics data is retained for up to 12 months</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">7. Your Rights Under POPIA</h2>
          <p>You have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal information we hold about you</li>
            <li>Request correction of inaccurate information</li>
            <li>Request deletion of your personal information</li>
            <li>Object to the processing of your information</li>
            <li>Withdraw your consent at any time</li>
            <li>Lodge a complaint with the Information Regulator of South Africa</li>
          </ul>
          <p>
            To exercise any of these rights, contact us at the email address below.
            We will respond within 30 days.
          </p>

          <h2 className="text-xl font-semibold mt-8">8. Data Security</h2>
          <p>We protect your data through:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Passwords hashed with bcrypt (industry standard)</li>
            <li>HTTPS encryption on all connections</li>
            <li>HttpOnly, Secure, SameSite cookies for authentication</li>
            <li>CSRF token protection on all state-changing requests</li>
            <li>Rate limiting to prevent abuse</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">9. Children's Privacy</h2>
          <p>
            SpeelDit is not directed at children under the age of 18. We do not knowingly
            collect personal information from children. If you believe a child has provided
            us with personal information, please contact us.
          </p>

          <h2 className="text-xl font-semibold mt-8">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Changes will be posted on
            this page with an updated "Last updated" date. Continued use of the service
            after changes constitutes acceptance of the updated policy.
          </p>

          <h2 className="text-xl font-semibold mt-8">11. Contact Us</h2>
          <p>
            For privacy-related enquiries or to exercise your POPIA rights:
          </p>
          <ul className="list-none pl-0 space-y-1">
            <li><strong>Email:</strong> bennokuhn1@icloud.com</li>
            <li><strong>Information Regulator (South Africa):</strong> <a href="https://inforegulator.org.za" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">inforegulator.org.za</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
