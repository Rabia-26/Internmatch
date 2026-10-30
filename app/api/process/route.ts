import { NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { getJob, updateJob } from "@/lib/db";
import { processInternMatch } from "@/lib/internMatchProcessor";
import { logger } from "@/lib/logger";

function getReceiver() {
  const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const next = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!current || !next) return null;
  return new Receiver({ currentSigningKey: current, nextSigningKey: next });
}

function base64ToFile(name: string, type: string, base64: string): File {
  const buffer = Buffer.from(base64, "base64");
  const bytes = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  return new File([bytes], name, { type });
}

export async function POST(req: Request) {
  const receiver = getReceiver();
  const signature = req.headers.get("upstash-signature") || "";
  const body = await req.text();

  if (!receiver) {
    // SECURITY: refuse all calls when no verifier is configured. The sync
    // fallback in /api/analyse does NOT invoke this endpoint, so blocking
    // is safe and prevents unauthenticated reprocessing.
    logger.warn(
      `[PROCESS] QStash receiver not configured; refusing public access`,
    );
    return new Response("Service Unavailable", { status: 503 });
  }

  try {
    const isValid = await receiver.verify({
      body,
      signature,
      clockTolerance: 60,
    });
    if (!isValid) {
      logger.warn(`[PROCESS] Invalid QStash signature`);
      return new Response("Unauthorized", { status: 401 });
    }
  } catch (verifyError) {
    logger.error(
      `[PROCESS] QStash signature verification failed:`,
      verifyError,
    );
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: { jobId: string; linked?: boolean };
  try {
    payload = JSON.parse(body);
  } catch {
    logger.error(`[PROCESS] Invalid JSON body`);
    return new Response("Bad Request", { status: 400 });
  }

  const { jobId } = payload;
  if (!jobId) {
    logger.error(`[PROCESS] Missing jobId in payload`);
    return new Response("Bad Request", { status: 400 });
  }

  logger.info(`[PROCESS] Received QStash job ${jobId}`);

  try {
    const job = await getJob(jobId);
    if (!job) {
      logger.error(`[PROCESS] Job ${jobId} not found`);
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "completed") {
      logger.info(`[PROCESS] Job ${jobId} already completed, skipping`);
      return NextResponse.json({ message: "Already completed" });
    }

    // Reconstruct File objects from stored base64 data.
    const fileRecords = job.files || [];
    const files = Array.isArray(fileRecords)
      ? fileRecords.map((f: any) =>
          base64ToFile(f.name, f.type, f.content),
        )
      : [];

    const progress = job.progress as { manualKeywords?: string } | null;

    logger.info(
      `[PROCESS] Reconstructed ${files.length} files for job ${jobId}`,
    );

    await processInternMatch(jobId, {
      roleFit: job.document_type ?? "general",
      location: job.effective_date ?? undefined,
      manualKeywords: progress?.manualKeywords,
      resumeFile: files[0] ?? null,
    });

    logger.info(`[PROCESS] Job ${jobId} completed successfully`);
    return NextResponse.json({ message: "Processing completed" });
  } catch (err: any) {
    logger.error(`[PROCESS] Job ${jobId} failed:`, err);
    try {
      await updateJob(jobId, {
        status: "failed",
        stage: "failed",
        error: err?.message ?? "Processing failed",
        failed_at: new Date().toISOString(),
      });
    } catch (dbError) {
      logger.error(
        `[PROCESS] Failed to persist failure for job ${jobId}:`,
        dbError,
      );
    }
    return NextResponse.json(
      { error: err?.message ?? "Processing failed" },
      { status: 500 },
    );
  }
}
