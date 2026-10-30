// lib/JobStore.ts
//
// NOTE: The in-memory `jobs` Map was removed because it
//   (a) didn't survive Next.js dev hot-reloads or serverless cold starts, and
//   (b) was disconnected from the DynamoDB-backed status the processor writes.
//
// All job state now lives in the `DocumentResults` table; read it via
// `app/api/status/[jobId]/route.ts`.
//
// The types remain for back-compat with any consumers that import them.

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface Job {
  jobId: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
  fileCount?: number;
  linked?: boolean;
}
