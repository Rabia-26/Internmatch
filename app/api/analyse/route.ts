import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { Client } from "@upstash/qstash";
import { createJob, updateJob } from "@/lib/db";
import { UPLOAD_DOCUMENT_LIMIT, createLimitPayload } from "@/lib/limits";
import { processInternMatch } from "@/lib/internMatchProcessor";
import { logger } from "@/lib/logger";

function isMissingFilesColumnError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    msg.includes("Could not find the 'files' column") ||
    msg.includes('Could not find the "files" column')
  );
}

function getQStashClient() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return null;
  return new Client({ token });
}

/** Public URL for QStash callbacks (Render sets RENDER_EXTERNAL_URL). */
function getPublicBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const render = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, "");
  if (render) return render;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

async function runInternMatchInBackground(
  jobId: string,
  params: Parameters<typeof processInternMatch>[1],
) {
  processInternMatch(jobId, params).catch(async (err) => {
    logger.error(`Job ${jobId} failed:`, err);
    try {
      await updateJob(jobId, {
        status: "failed",
        stage: "failed",
        error: err instanceof Error ? err.message : "Processing failed",
        failed_at: new Date().toISOString(),
      });
    } catch (e) {
      logger.error(`Failed to persist failure for job ${jobId}:`, e);
    }
  });
}

// 5 upload requests per 60s per IP (per server instance).
const limiter = new RateLimiterMemory({ points: 5, duration: 60 });

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_EXTS = new Set(["pdf", "docx", "doc", "txt"]);
const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "application/msword",
  "text/",
  "application/vnd.openxmlformats",
];

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function fileIsAllowed(file: File): { ok: boolean; reason?: string } {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, reason: `File "${file.name}" exceeds 50MB.` };
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return {
      ok: false,
      reason: `File "${file.name}" has unsupported extension ".${ext}".`,
    };
  }
  if (
    file.type &&
    !ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p))
  ) {
    // Some browsers omit mime type; only fail when an explicit one is supplied AND not matching.
    return {
      ok: false,
      reason: `File "${file.name}" has unsupported MIME "${file.type}".`,
    };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  try {
    const clientKey = getClientIp(req);

    try {
      await limiter.consume(clientKey);
    } catch {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a minute." },
        { status: 429 },
      );
    }

    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const roleFit = (formData.get("roleFit") as string) || "";
    const location = (formData.get("location") as string) || undefined;
    const manualKeywords =
      (formData.get("manualKeywords") as string) || undefined;
    const resume =
      files[0] && files[0].size > 0 ? (files[0] as File) : null;

    if (!roleFit) {
      return NextResponse.json(
        { error: "Select what fits you best (role track)." },
        { status: 400 },
      );
    }

    if (!resume && !manualKeywords?.trim()) {
      return NextResponse.json(
        {
          error:
            "Upload a resume or enter keywords (skills, stack, domain).",
        },
        { status: 400 },
      );
    }

    if (files.length > UPLOAD_DOCUMENT_LIMIT) {
      return NextResponse.json(createLimitPayload("upload_document_limit"), {
        status: 429,
      });
    }

    for (const f of files) {
      const check = fileIsAllowed(f);
      if (!check.ok) {
        return NextResponse.json({ error: check.reason }, { status: 400 });
      }
    }

    const filesToStore = resume ? [resume] : [];

    const jobId = randomUUID();
    logger.info(
      `[ANALYSE] job ${jobId}: resume=${Boolean(resume)}, role=${roleFit}`,
    );

    // Read files into memory and convert to base64 for QStash storage.
    const fileData = await Promise.all(
      filesToStore.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return {
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          content: buffer.toString("base64"),
        };
      }),
    );

    // Create the job record up-front so /status can find it immediately.
    await createJob(jobId, {
      status: "processing",
      stage: "queued",
      progress: {
        processedFiles: 0,
        totalFiles: filesToStore.length,
        manualKeywords: manualKeywords ?? "",
      },
      file_count: filesToStore.length,
      linked: false,
      document_type: roleFit,
      effective_date: location ?? null,
      user_id: null,
    });

    // Store file data in the job record for the QStash worker to pick up.
    // Some deployed DBs may not have the legacy `files` column; when missing,
    // we fall back to in-process execution instead of failing the request.
    let canUseQueuedProcessing = true;
    try {
      await updateJob(jobId, { files: fileData });
    } catch (err) {
      if (isMissingFilesColumnError(err)) {
        canUseQueuedProcessing = false;
        logger.warn(
          `[ANALYSE] jobs.files column missing; using in-process fallback for ${jobId}`,
        );
      } else {
        throw err;
      }
    }

    // Publish QStash message to trigger processing, or fall back to sync.
    const qstash = getQStashClient();
    if (qstash && canUseQueuedProcessing) {
      const baseUrl = getPublicBaseUrl();

      try {
        await qstash.publishJSON({
          url: `${baseUrl}/api/process`,
          body: { jobId },
          retries: 3,
        });
        logger.info(`[ANALYSE] QStash job published for ${jobId}`);
      } catch (qstashError) {
        logger.error(`[ANALYSE] QStash publish failed:`, qstashError);
        await updateJob(jobId, {
          status: "failed",
          stage: "failed",
          error: "Failed to queue processing job",
          failed_at: new Date().toISOString(),
        });
        return NextResponse.json(
          { error: "Failed to queue processing job" },
          { status: 500 },
        );
      }
    } else {
      logger.warn(
        `[ANALYSE] QStash not configured, falling back to sync processing for ${jobId}`,
      );
      void runInternMatchInBackground(jobId, {
        roleFit,
        location,
        manualKeywords,
        resumeFile: resume,
      });
    }

    return NextResponse.json({ jobId, message: "Processing started" });
  } catch (error) {
    logger.error("API /analyse route error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
