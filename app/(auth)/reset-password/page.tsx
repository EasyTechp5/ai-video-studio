import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/forms/AuthForm";

export const metadata: Metadata = { title: "Reset password" };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="reset" />
    </Suspense>
  );
}
