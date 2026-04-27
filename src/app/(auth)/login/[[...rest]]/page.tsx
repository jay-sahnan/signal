import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
