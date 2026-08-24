import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { Button, Card, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <PageContainer className="max-w-2xl py-20">
      <Card>
        <EmptyState icon={<FileQuestion className="size-6" />} title="Page not found" description="The page or demo application you requested does not exist." action={<Button asChild><Link href="/">Return home</Link></Button>} />
      </Card>
    </PageContainer>
  );
}
