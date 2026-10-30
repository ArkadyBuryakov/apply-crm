import { useParams } from "@tanstack/react-router";
import { ProjectMemoryCard, UserMemoryCard } from "@/components/memory";
import { PageHeader } from "@/components/ui/misc";

export function MemoryPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/memory" });
  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="Memory"
        subtitle="What the assistant and connected MCP clients remember between conversations."
      />
      <ProjectMemoryCard projectId={projectId} />
      <UserMemoryCard />
    </div>
  );
}
