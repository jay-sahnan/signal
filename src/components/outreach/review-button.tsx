import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReviewButtonProps {
  sequenceId: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  label?: string;
  className?: string;
}

export function ReviewButton({
  sequenceId,
  variant = "outline",
  size = "sm",
  label = "Review",
  className,
}: ReviewButtonProps) {
  return (
    <Link
      href={`/outreach/review?sequence=${sequenceId}`}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {label}
    </Link>
  );
}
