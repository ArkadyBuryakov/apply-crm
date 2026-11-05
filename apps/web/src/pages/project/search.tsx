import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { ActionDialog } from "@/components/action-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { EmptyState, Loading, PageHeader } from "@/components/ui/misc";
import { type Action, api, unwrap } from "@/lib/api";
import { humanize } from "@/lib/utils";

export function SearchPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/search" });
  const { q } = useSearch({ from: "/authed/p/$projectId/search" });
  const navigate = useNavigate();
  const [text, setText] = useState(q);
  const [opened, setOpened] = useState<Action | null>(null);
  const results = useQuery({
    queryKey: ["search", projectId, q],
    enabled: q.length > 0,
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/search", { params: { path: { projectId }, query: { q, limit: 50 } } }),
        )
      ).items,
  });

  async function openAction(id: string) {
    setOpened(
      await unwrap(
        api.GET("/api/projects/{projectId}/actions/{actionId}", { params: { path: { projectId, actionId: id } } }),
      ),
    );
  }

  return (
    <div>
      {/* Phones have no search field in the header, so the page brings its own. */}
      <form
        className="mb-4 md:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ to: ".", search: { q: text.trim() } });
        }}
      >
        <Input
          type="search"
          enterKeyHint="search"
          autoFocus={!q}
          aria-label="Search"
          placeholder="Organizations, positions, people, actions…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      {q ? <PageHeader title={`Results for “${q}”`} /> : null}
      {results.isLoading ? <Loading /> : null}
      {results.data?.length === 0 ? <EmptyState title="Nothing found" /> : null}
      <div className="grid gap-2">
        {results.data?.map((hit) => {
          const body = (
            <Card className="hover:border-primary/50">
              <CardContent className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>
                  <span className="font-medium">{hit.title}</span>
                  {hit.subtitle ? <span className="text-muted-foreground"> · {humanize(hit.subtitle)}</span> : null}
                </span>
                <Badge>{hit.type}</Badge>
              </CardContent>
            </Card>
          );
          if (hit.type === "organization")
            return (
              <Link
                key={hit.id}
                to="/p/$projectId/organizations/$organizationId"
                params={{ projectId, organizationId: hit.id }}
              >
                {body}
              </Link>
            );
          if (hit.type === "position")
            return (
              <Link key={hit.id} to="/p/$projectId/positions/$positionId" params={{ projectId, positionId: hit.id }}>
                {body}
              </Link>
            );
          if (hit.type === "contact")
            return (
              <Link key={hit.id} to="/p/$projectId/contacts/$contactId" params={{ projectId, contactId: hit.id }}>
                {body}
              </Link>
            );
          return (
            <button key={hit.id} type="button" className="cursor-pointer text-left" onClick={() => openAction(hit.id)}>
              {body}
            </button>
          );
        })}
      </div>
      {opened ? <ActionDialog projectId={projectId} open onOpenChange={() => setOpened(null)} action={opened} /> : null}
    </div>
  );
}
