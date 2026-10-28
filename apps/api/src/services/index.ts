import type { AiProviders } from "../assistant/providers.js";
import type { BlobStore } from "./blobs.js";
import type { JobQueue } from "./jobs.js";

/** Infrastructure the routes depend on; swapped for in-memory fakes in tests. */
export type Services = {
  blobs: BlobStore;
  jobs: JobQueue;
  ai: AiProviders;
};
