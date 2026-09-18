import { LegalDoc } from "@/components/legal-doc";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy Policy" updated="September 17, 2026">
      <p>
        This Policy explains what we collect, why, and your choices when you use ClipWaltz.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — your name, email, and authentication details.</li>
        <li><strong>Your Content</strong> — the photos and videos you upload, and the videos we render for you.</li>
        <li><strong>Billing data</strong> — handled by our payment processor; we store subscription status, not full card numbers.</li>
        <li><strong>Usage &amp; device data</strong> — logs, IP address, and basic analytics to operate and secure the Service.</li>
      </ul>

      <h2>2. How we use it</h2>
      <p>
        To provide and improve the Service (process uploads, render videos, deliver downloads), to
        manage billing, to communicate with you, and to keep the Service secure. We do not sell your
        personal information.
      </p>

      <h2>3. Storage &amp; retention</h2>
      <p>
        Your Content is stored in our object storage to provide the Service. Free-tier source media may
        be auto-deleted after the stated retention window unless you keep it via a paid plan. You can
        delete projects and your account at any time; deletion removes associated media on our normal
        cleanup cycle.
      </p>

      <h2>4. Sharing</h2>
      <p>
        We share data only with service providers that help us run the Service (e.g. payment
        processing, email delivery, hosting) under appropriate safeguards, or where required by law. If
        you choose to publish or share a creation, that content becomes visible per your sharing choice.
      </p>

      <h2>5. Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct, export, or delete your
        personal data. Contact us to exercise them.
      </p>

      <h2>6. Cookies</h2>
      <p>
        We use essential cookies for authentication and preferences (such as your theme). We keep
        non-essential tracking to a minimum.
      </p>

      <h2>7. Contact</h2>
      <p>
        Privacy questions or requests: <a href="mailto:privacy@clipwaltz.com">privacy@clipwaltz.com</a>.
      </p>
    </LegalDoc>
  );
}
