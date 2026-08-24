"use client";

import { useEffect } from "react";
import { PageContainer } from "@/components/app-shell";
import { Alert, Button, Card } from "@/components/ui";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <PageContainer className="max-w-2xl py-20">
      <Card className="p-6 sm:p-8">
        <Alert tone="error" title="This page could not be loaded">
          Your data has not been submitted. Please try the page again.
        </Alert>
        <Button onClick={reset} className="mt-5">Try again</Button>
      </Card>
    </PageContainer>
  );
}
