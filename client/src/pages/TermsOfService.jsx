import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-white text-zinc-800">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/" className="text-brand-600 hover:text-brand-700 text-sm mb-8 inline-block">&larr; Back to Home</Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-zinc-500 text-sm mb-8">Last updated: 11 April 2026</p>

        <div className="prose prose-zinc max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>
            These Terms of Service ("Terms") govern your use of the SpeelDit web application
            operated at speeldit.com ("Service"). By accessing or using the Service, you agree
            to be bound by these Terms. If you do not agree, do not use the Service.
          </p>

          <h2 className="text-xl font-semibold mt-8">1. Definitions</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>"SpeelDit"</strong>, <strong>"we"</strong>, <strong>"us"</strong> &mdash; the operator of this Service</li>
            <li><strong>"Venue Owner"</strong> &mdash; a person or entity that registers a venue account</li>
            <li><strong>"Customer"</strong> &mdash; any person who uses the voting or song request features at a venue</li>
            <li><strong>"Venue"</strong> &mdash; a physical establishment (bar, restaurant, club, etc.) registered on the Service</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">2. Service Description</h2>
          <p>
            SpeelDit provides a digital jukebox platform that allows venue owners to manage music
            queues and allows customers to vote on and request songs. The Service includes real-time
            queue management, music playback via Apple Music, optional paid song requests, and
            analytics for venue owners.
          </p>

          <h2 className="text-xl font-semibold mt-8">3. Account Registration</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>Venue owners must provide a valid email address and create a password to register</li>
            <li>You are responsible for maintaining the confidentiality of your account credentials</li>
            <li>You must provide accurate and complete information during registration</li>
            <li>One venue per account; contact us if you need multiple venues</li>
            <li>We reserve the right to suspend or terminate accounts that violate these Terms</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">4. Music Licensing &mdash; Venue Responsibility</h2>
          <p className="font-semibold text-zinc-900">
            Venue owners are solely responsible for obtaining and maintaining all necessary music
            performance licenses required by South African law to play music publicly at their
            establishment.
          </p>
          <p>This includes, but is not limited to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>SAMRO</strong> (South African Music Rights Organisation) &mdash; licence for public performance of musical works</li>
            <li><strong>SAMPRA</strong> (South African Music Performance Rights Association) &mdash; licence for public performance of sound recordings</li>
            <li>Any other licences required by applicable law or regulation</li>
          </ul>
          <p>
            SpeelDit is a technology platform that facilitates queue management and music playback.
            We do not grant any music performance rights. By using the Service, venue owners confirm
            that they hold all necessary licences for public music performance at their venue.
            SpeelDit bears no liability for any venue's failure to obtain proper licensing.
          </p>

          <h2 className="text-xl font-semibold mt-8">5. Apple Music</h2>
          <p>
            Music playback is powered by Apple Music. Venue owners must have a valid Apple Music
            subscription to use the playback features. Use of Apple Music through SpeelDit is subject
            to Apple's terms of service. SpeelDit is not affiliated with or endorsed by Apple Inc.
          </p>

          <h2 className="text-xl font-semibold mt-8">6. Payments and Refunds</h2>
          <p>When a venue enables paid song requests:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Payments are processed securely by <strong>Yoco</strong>, a licensed payment service provider</li>
            <li>We do not store credit card or banking details</li>
            <li>The price per song request is set by the venue owner (R5 &ndash; R50)</li>
            <li>Revenue is split: 80% to the venue owner, 20% platform fee</li>
            <li>Refunds may be issued at the venue owner's discretion for songs that were not played</li>
            <li>To request a refund, contact the venue directly or email us at the address below</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">7. Acceptable Use</h2>
          <p>You agree NOT to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the Service for any unlawful purpose</li>
            <li>Attempt to manipulate votes, spam song requests, or abuse the queue system</li>
            <li>Attempt to access another venue owner's account or data</li>
            <li>Reverse-engineer, scrape, or copy the Service</li>
            <li>Use automated bots or scripts to interact with the Service</li>
            <li>Upload or transmit malicious code or content</li>
            <li>Interfere with or disrupt the Service or its infrastructure</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">8. Intellectual Property</h2>
          <p>
            The SpeelDit name, logo, and all software code are the intellectual property of
            SpeelDit. You may not copy, modify, distribute, or create derivative works from
            any part of the Service without our written consent.
          </p>
          <p>
            Song titles, artist names, album artwork, and lyrics displayed in the Service are
            the property of their respective rights holders.
          </p>

          <h2 className="text-xl font-semibold mt-8">9. Limitation of Liability</h2>
          <p>To the maximum extent permitted by South African law:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>The Service is provided <strong>"as is"</strong> without warranties of any kind</li>
            <li>We do not guarantee uninterrupted or error-free operation of the Service</li>
            <li>We are not liable for any loss of revenue, data, or business opportunities arising from the use or inability to use the Service</li>
            <li>Our total liability to you shall not exceed the amount you paid to us in the 12 months preceding the claim</li>
            <li>We are not responsible for the content of songs, lyrics, or any third-party services</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">10. Indemnification</h2>
          <p>
            Venue owners agree to indemnify and hold SpeelDit harmless from any claims, damages,
            or expenses arising from: (a) their failure to obtain proper music licensing, (b) their
            use of the Service in violation of these Terms, or (c) any dispute between the venue
            and its customers.
          </p>

          <h2 className="text-xl font-semibold mt-8">11. Service Availability</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>We aim to maintain high availability but do not guarantee 100% uptime</li>
            <li>We may perform maintenance that temporarily disrupts the Service</li>
            <li>We reserve the right to modify, suspend, or discontinue the Service at any time with reasonable notice</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">12. Termination</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>You may close your account at any time by contacting us</li>
            <li>We may suspend or terminate your account for violation of these Terms</li>
            <li>Upon termination, your venue data will be deleted within 30 days, except where retention is required by law</li>
          </ul>

          <h2 className="text-xl font-semibold mt-8">13. Consumer Protection Act</h2>
          <p>
            In accordance with the South African Consumer Protection Act (CPA), electronic
            transactions made through the Service are subject to a 7-day cooling-off period
            where applicable. This does not apply to digital content that has been delivered
            (i.e., a song that has already been played).
          </p>

          <h2 className="text-xl font-semibold mt-8">14. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the Republic of South Africa. Any disputes
            shall be resolved in the courts of South Africa.
          </p>

          <h2 className="text-xl font-semibold mt-8">15. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. Changes will be posted on this page
            with an updated date. Continued use of the Service after changes constitutes
            acceptance of the updated Terms.
          </p>

          <h2 className="text-xl font-semibold mt-8">16. Contact Us</h2>
          <p>For questions about these Terms:</p>
          <ul className="list-none pl-0 space-y-1">
            <li><strong>Email:</strong> bennokuhn1@icloud.com</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
