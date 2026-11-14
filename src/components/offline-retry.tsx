"use client";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OfflineRetry() {
  return (
    <Button onClick={() => location.reload()}>
      <RefreshCw /> Try again
    </Button>
  );
}
