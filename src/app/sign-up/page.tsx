import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </div>
  );
}
