import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/reset-password-form";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
