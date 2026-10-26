import type { CommentTarget } from "@crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { api, unwrap } from "@/lib/api";
import { useCan, useMe, useProjectMutation } from "@/lib/queries";
import { formatDateTime } from "@/lib/utils";

export function Comments({
  projectId,
  targetType,
  targetId,
}: {
  projectId: string;
  targetType: CommentTarget;
  targetId: string;
}) {
  const can = useCan(projectId);
  const me = useMe();
  const [body, setBody] = useState("");
  const comments = useQuery({
    queryKey: ["comments", projectId, targetType, targetId],
    queryFn: async () =>
      (
        await unwrap(
          api.GET("/api/projects/{projectId}/comments", {
            params: { path: { projectId }, query: { targetType, targetId } },
          }),
        )
      ).items,
  });
  const add = useProjectMutation(
    projectId,
    () =>
      unwrap(
        api.POST("/api/projects/{projectId}/comments", {
          params: { path: { projectId } },
          body: { targetType, targetId, body },
        }),
      ),
    { onSuccess: () => setBody("") },
  );
  const remove = useProjectMutation(projectId, (commentId: string) =>
    unwrap(
      api.DELETE("/api/projects/{projectId}/comments/{commentId}", { params: { path: { projectId, commentId } } }),
    ),
  );

  return (
    <div className="grid gap-3">
      {comments.data?.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
      {comments.data?.map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{c.authorName ?? "Former member"}</span> ·{" "}
              {formatDateTime(c.createdAt)}
              {c.editedAt ? " · edited" : ""}
            </span>
            {c.authorId === me.data?.id || can("comment:moderate") ? (
              <Button variant="ghost" size="icon" aria-label="Delete comment" onClick={() => remove.mutate(c.id)}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap text-sm">{c.body}</p>
        </div>
      ))}
      {can("comment:create") ? (
        <div className="grid gap-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" />
          <Button className="w-fit" disabled={!body.trim() || add.isPending} onClick={() => add.mutate(undefined)}>
            Comment
          </Button>
        </div>
      ) : null}
    </div>
  );
}
