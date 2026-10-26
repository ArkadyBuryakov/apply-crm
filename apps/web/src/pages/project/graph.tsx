import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { GraphView } from "@/components/graph-view";
import { Select } from "@/components/ui/form";
import { Loading, PageHeader } from "@/components/ui/misc";
import { api, unwrap } from "@/lib/api";
import { useOrganizations, usePositions } from "@/lib/queries";

export function GraphPage() {
  const { projectId } = useParams({ from: "/authed/p/$projectId/graph" });
  const search = useSearch({ from: "/authed/p/$projectId/graph" });
  const navigate = useNavigate({ from: "/p/$projectId/graph" });
  const positions = usePositions(projectId);
  const orgs = useOrganizations(projectId);
  const graph = useQuery({
    queryKey: ["graph", projectId, search],
    queryFn: () =>
      unwrap(
        api.GET("/api/projects/{projectId}/graph", {
          params: {
            path: { projectId },
            query: {
              ...(search.positionId ? { positionId: search.positionId } : {}),
              ...(search.organizationId ? { organizationId: search.organizationId } : {}),
            },
          },
        }),
      ),
  });
  const filter = search.positionId
    ? `p:${search.positionId}`
    : search.organizationId
      ? `o:${search.organizationId}`
      : "";

  return (
    <div>
      <PageHeader
        title="Action graph"
        subtitle="How actions led to each other. Drag from a node's bottom handle to another node to link them; click an edge to remove it."
        actions={
          <Select
            className="w-72"
            value={filter}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              navigate({
                search: kind === "p" ? { positionId: id } : kind === "o" ? { organizationId: id } : {},
              });
            }}
            aria-label="Filter"
          >
            <option value="">Whole project</option>
            <optgroup label="Positions">
              {positions.data?.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.title}
                  {p.company ? ` — ${p.company.name}` : ""}
                </option>
              ))}
            </optgroup>
            <optgroup label="Organizations">
              {orgs.data?.map((o) => (
                <option key={o.id} value={`o:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
          </Select>
        }
      />
      {graph.isLoading ? <Loading /> : null}
      {graph.data ? (
        <>
          {graph.data.truncated ? (
            <p className="mb-2 text-xs text-warning">
              Showing the newest actions only; filter by a position to see all.
            </p>
          ) : null}
          <GraphView projectId={projectId} actions={graph.data.nodes} edges={graph.data.edges} height={680} />
        </>
      ) : null}
    </div>
  );
}
