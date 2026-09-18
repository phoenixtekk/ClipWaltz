import { LegalDoc } from "@/components/legal-doc";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Service" updated="September 17, 2026">
      <p>
        These Terms govern your use of ClipWaltz (the &ldquo;Service&rdquo;), operated by ClipWaltz
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using the Service you agree to
        these Terms.
      </p>

      <h2>1. Your account</h2>
      <p>
        You must provide accurate information and are responsible for activity under your account and
        for keeping your credentials secure. You must be old enough to form a binding contract in your
        jurisdiction.
      </p>

      <h2>2. Your content</h2>
      <p>
        You keep ownership of the photos, videos, and other material you upload (&ldquo;Your
        Content&rdquo;). You grant us a limited license to store, process, and transform Your Content
        solely to provide the Service — for example, to assemble it into a rendered video and deliver
        it back to you. You are responsible for having the rights to everything you upload.
      </p>
      <ul>
        <li>Don&rsquo;t upload content you don&rsquo;t have the rights to, or that is unlawful, infringing, or harmful.</li>
        <li>We may remove content or suspend accounts that violate these Terms.</li>
      </ul>

      <h2>3. Music</h2>
      <p>
        Soundtracks offered in the Service are provided under royalty-free licenses for use inside the
        videos you create with the Service. You may not extract, redistribute, or resell the music on a
        standalone basis.
      </p>

      <h2>4. Plans, billing &amp; trials</h2>
      <p>
        Paid plans (Plus, Pro) are billed in advance on a recurring basis through our payment
        processor. Prices are shown at checkout. You can cancel anytime; cancellation stops future
        renewals and access continues until the end of the current period. See our{" "}
        <a href="/refund">Refund Policy</a>.
      </p>

      <h2>5. Acceptable use</h2>
      <p>
        Don&rsquo;t misuse the Service: no reverse engineering, scraping, overloading our systems,
        bypassing limits, or using it to create unlawful, deceptive, or infringing content.
      </p>

      <h2>6. Availability &amp; changes</h2>
      <p>
        We may modify or discontinue features. We aim for high availability but the Service is provided
        &ldquo;as is&rdquo; without warranties. To the maximum extent permitted by law, we are not
        liable for indirect or consequential damages, and our total liability is limited to the amount
        you paid in the prior 12 months.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access for violations
        of these Terms. Free-tier source media may be deleted after the stated retention period.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:support@clipwaltz.com">support@clipwaltz.com</a>.
      </p>
    </LegalDoc>
  );
}
