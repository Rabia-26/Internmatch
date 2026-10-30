// app/api/results/route.ts
import { NextResponse } from "next/server";
import { getJob } from "@/lib/db";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json(
        {
          status: "idle",
          jobId: null,
          result: null,
          error: "jobId is required",
        },
        { status: 400 },
      );
    }

    const job = await getJob(jobId);

    if (!job) {
      return NextResponse.json(
        {
          status: "error",
          jobId,
          result: null,
          error: "Job not found",
        },
        { status: 404 },
      );
    }

    console.log("API STATUS RETURNED:", job.status);

    const limitedResult =
      job.status === "completed" && job.result ? job.result : null;

    return NextResponse.json({
      jobId,
      status: job.status ?? "idle",
      stage: job.stage ?? "queued",
      progress: job.progress ?? null,
      result: limitedResult,
      error: job.status === "failed" ? (job.error ?? null) : null,
      completedAt: job.completedAt ?? null,
      createdAt: job.createdAt ?? null,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: "error",
      jobId: null,
      result: null,
      error: err?.message ?? "Failed to fetch results",
    });
  }
}
