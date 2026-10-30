import { createJob, getJob, updateJob } from "./db";
import { normalization } from "./normalize";
import {
  extractKeywordsFromResume,
  mergeKeywords,
  parseManualKeywords,
} from "./keywordExtractor";
import { searchInternshipsAcrossWeb, type JobListing } from "./jobSearch";
import { scoreListingMatch } from "./jobScraper";
import { logger } from "./logger";

type Stage =
  | "queued"
  | "ocr"
  | "structure"
  | "claims"
  | "differences"
  | "completed"
  | "failed";

export type InternMatchParams = {
  roleFit: string;
  location?: string;
  manualKeywords?: string;
  resumeFile?: File | null;
};

async function setStage(jobId: string, stage: Stage, extra?: Record<string, unknown>) {
  try {
    await updateJob(jobId, { stage, ...extra });
  } catch (err) {
    logger.warn(`[INTERN] setStage(${stage}) failed:`, err);
  }
}

function listingsToGroups(listings: JobListing[], keywords: string[]) {
  const bySource = new Map<string, JobListing[]>();
  for (const job of listings) {
    const key = job.source;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(job);
  }

  const groups = Array.from(bySource.entries()).map(([source, jobs]) => {
    const findings = jobs
      .map((job, idx) => {
        const matchScore = scoreListingMatch(job, keywords);
        const urlSlug = job.url.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 32);
        return {
          id: `${source}-${idx}-${urlSlug || idx}`,
          type: "green" as const,
          matchScore,
          claimA: {
            document: source,
            clause: job.company,
            text: `${job.title} — ${job.location}`,
          },
          claimB: {
            document: "Apply",
            clause: job.url,
            text: job.description || job.url,
          },
          explanation: `Match score ${matchScore} · keywords: ${keywords.slice(0, 6).join(", ")}`,
        };
      })
      .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

    return {
      docId: `source-${source.toLowerCase().replace(/\s+/g, "-")}`,
      name: `${source} · ${findings.length} match${findings.length === 1 ? "" : "es"}`,
      summary: {
        contradictions: 0,
        changes: findings.length,
        obligations: 0,
        scope: keywords.length,
      },
      findings,
    };
  });

  return groups;
}

export async function processInternMatch(
  jobId: string,
  params: InternMatchParams,
) {
  const { roleFit, location, manualKeywords, resumeFile } = params;
  const manual = parseManualKeywords(manualKeywords ?? "");

  try {
    const existing = await getJob(jobId);
    if (!existing) {
      await createJob(jobId, {
        status: "processing",
        stage: "ocr",
        progress: { processedFiles: 0, totalFiles: resumeFile ? 1 : 0 },
        file_count: resumeFile ? 1 : 0,
        linked: false,
        document_type: roleFit,
        effective_date: location ?? null,
      });
    }

    let profileKeywords: string[] = [];
    let profileSummary = "Manual keyword search.";

    if (resumeFile) {
      await setStage(jobId, "ocr");
      const resumeText = await normalization(resumeFile);
      await setStage(jobId, "structure");
      await updateJob(jobId, {
        progress: {
          processedFiles: 1,
          totalFiles: 1,
          resumePreview: resumeText.slice(0, 500),
        },
      });

      await setStage(jobId, "claims");
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        const profile = await extractKeywordsFromResume(resumeText, groqKey);
        profileKeywords = profile.keywords;
        profileSummary = profile.summary;
      } else {
        profileKeywords = manual.length ? manual : ["internship"];
        profileSummary = "GROQ_API_KEY not set — using manual keywords only.";
      }
    } else {
      await setStage(jobId, "claims");
      profileKeywords = manual;
    }

    const keywords = mergeKeywords(manual, profileKeywords, roleFit);

    await setStage(jobId, "differences");
    const listings = await searchInternshipsAcrossWeb({
      keywords,
      location,
      onSourceStart: (sourceId, index, total) => {
        void updateJob(jobId, {
          progress: {
            processedFiles: resumeFile ? 1 : 0,
            totalFiles: resumeFile ? 1 : 0,
            searchBoard: sourceId,
            searchProgress: `${index + 1}/${total}`,
          },
        }).catch(() => {});
      },
    });
    const groups = listingsToGroups(listings, keywords);

    await updateJob(jobId, {
      status: "completed",
      stage: "completed",
      completed_at: new Date().toISOString(),
      result: {
        groups,
        profile: {
          roleFit,
          location: location ?? null,
          keywords,
          summary: profileSummary,
        },
        summary: {
          totalClaims: keywords.length,
          totalDocuments: resumeFile ? 1 : 0,
          totalContradictions: 0,
          totalChanges: listings.length,
        },
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Processing failed";
    logger.error(`[INTERN] Job ${jobId} failed:`, err);
    await updateJob(jobId, {
      status: "failed",
      stage: "failed",
      error: message,
      failed_at: new Date().toISOString(),
    });
    throw err;
  }
}

/** Backward-compatible entry for QStash worker when a resume file is present. */
export async function processDocuments(
  jobId: string,
  files: File[],
  _linked = false,
) {
  const job = await getJob(jobId);
  const progress = job?.progress as { manualKeywords?: string } | null;
  const resumeFile = files[0] ?? null;

  await processInternMatch(jobId, {
    roleFit: job?.document_type ?? "general",
    location: job?.effective_date ?? undefined,
    manualKeywords: progress?.manualKeywords,
    resumeFile,
  });
}
