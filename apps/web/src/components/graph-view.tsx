// React Flow and dagre are large; load them only when a graph is shown.

import { type ComponentProps, lazy, Suspense } from "react";
import { Loading } from "@/components/ui/misc";

const Impl = lazy(() => import("./graph-view-impl").then((m) => ({ default: m.GraphView })));

export function GraphView(props: ComponentProps<typeof Impl>) {
  return (
    <Suspense fallback={<Loading />}>
      <Impl {...props} />
    </Suspense>
  );
}
