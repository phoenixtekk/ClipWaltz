import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <ForgotPasswordForm />
      </Suspense>
    </div>
  );
}
