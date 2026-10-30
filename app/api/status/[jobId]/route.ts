import { NextResponse } from "next/server";
import { getJob } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  try {
    const job = await getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        jobId: job.jobId,
        status: job.status,
        stage: job.stage ?? "queued",
        progress: job.progress ?? null,
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        failedAt: job.failedAt,
        error: job.error,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  } catch (err: unknown) {
    const e = err as { message?: string };
    return NextResponse.json(
      { error: e?.message ?? "Failed to fetch job status" },
      { status: 500 },
    );
  }
}
