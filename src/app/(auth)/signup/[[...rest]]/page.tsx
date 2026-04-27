import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";

export default function SignupPage() {
  return (
    <Suspense>
      <SignUp />
    </Suspense>
  );
}
