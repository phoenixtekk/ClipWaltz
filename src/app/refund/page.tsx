import { LegalDoc } from "@/components/legal-doc";

export const metadata = { title: "Refund Policy" };

export default function RefundPage() {
  return (
    <LegalDoc title="Refund Policy" updated="September 17, 2026">
      <p>
        We want you to be happy with ClipWaltz. This policy explains refunds for paid plans.
      </p>

      <h2>1. Subscriptions</h2>
      <p>
        Paid plans (Plus, Pro) are billed in advance. You can cancel anytime from your billing page —
        cancellation stops future renewals and your paid features remain until the end of the current
        billing period. We don&rsquo;t automatically prorate partial periods.
      </p>

      <h2>2. 7-day satisfaction window</h2>
      <p>
        If you&rsquo;re not satisfied, contact us within <strong>7 days</strong> of your first payment
        for a new subscription and we&rsquo;ll refund that charge. Repeated refund requests or apparent
        abuse may be declined.
      </p>

      <h2>3. Renewals</h2>
      <p>
        Renewal charges are generally non-refundable, but reach out if something went wrong (e.g. you
        meant to cancel and didn&rsquo;t use the Service that period) and we&rsquo;ll review it in good
        faith.
      </p>

      <h2>4. How to request</h2>
      <p>
        Email <a href="mailto:support@clipwaltz.com">support@clipwaltz.com</a> from your account email
        with the charge date. Approved refunds are returned to your original payment method; timing
        depends on your bank or card issuer.
      </p>

      <h2>5. Statutory rights</h2>
      <p>
        Nothing here limits any non-waivable refund or consumer rights you have under applicable law.
      </p>
    </LegalDoc>
  );
}
