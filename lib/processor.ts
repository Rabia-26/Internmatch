import {
  createJob,
  updateJob,
  getJob,
  createDocument,
  updateDocument,
  getDocumentByDocId,
  createClaims,
} from "./db";
import { normalization } from "./normalize";
import { retrieveAndStoreStructure } from "@/lib/structureExtractor";
import { extractClaims } from "./claim_extractor/claim_extractor";
import {
  computeIntraDocumentDifferences,
  computeCrossDocumentDifferences,
  getDifferences,
} from "./difference";
import { logger } from "./logger";

type Stage =
  | "queued"
  | "ocr"
  | "structure"
  | "claims"
  | "differences"
  | "completed"
  | "failed";

async function setStage(
  jobId: string,
  stage: Stage,
  extra?: Record<string, unknown>,
) {
  try {
    const updates: any = { stage };
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        updates[k] = v;
      }
    }
    await updateJob(jobId, updates);
  } catch (err) {
    logger.warn(`[PROC] setStage(${stage}) failed:`, err);
  }
}

const DEFAULT_INTENT = "policy requirements and obligations";

function extractDocumentName(docId: string): string {
  const idx = docId.indexOf("#");
  return idx >= 0 ? docId.slice(idx + 1) : docId;
}

interface ExtractedClaim {
  docId: string;
  sourceId?: string;
  claimType: string;
  actorRole?: string;
  actorRef?: string;
  claimText: string;
  model?: string;
  provider?: string;
  embedding?: number[];
}

interface Claim extends ExtractedClaim {
  claimId: string;
  intent: string;
}

interface Group {
  docId: string;
  name: string;
  summary: {
    contradictions: number;
    changes: number;
    obligations: number;
    scope: number;
  };
  findings: Finding[];
}

interface Finding {
  id: string;
  type: string; // "green", "yellow", or "red"
  claimA: {
    document: string;
    clause: string;
    text: string;
  };
  claimB?: {
    document: string;
    clause: string;
    text: string;
  };
  explanation: string;
}

interface DocumentStructure {
  type: string;
  id?: string;
  text: string;
  section?: string;
  level?: number;
}

interface Difference {
  docId: string;
  differenceId: string;
  type:
    | "contradiction"
    | "consistency"
    | "complementary"
    | "similarity"
    | "change"
    | "obligation";
  claimAId: string;
  claimBId: string;
  claimAText: string;
  claimBText: string;
  claimAType: string;
  claimBType: string;
  docAId: string;
  docBId: string;
  similarityScore?: number;
  explanation: string;
  detectedAt: number;
  createdAt: number;
  jobId: string;
  contradiction?: boolean;
}

export async function processDocuments(
  jobId: string,
  files: File[],
  linked: boolean = false,
) {
  console.log(`STARTING DOCUMENT PROCESSING`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Total files: ${files.length}`);
  console.log(`CIDL Linked: ${linked}`);

  const startTime = Date.now();

  try {
    console.log(`Creating initial job record`);

    // Job record is created up-front by the /analyse route so /status sees
    // it immediately. Only ensure it exists; do not overwrite.
    const existingJob = await getJob(jobId);
    if (!existingJob) {
      await createJob(jobId, {
        status: "processing",
        stage: "ocr",
        progress: { processedFiles: 0, totalFiles: files.length },
        file_count: files.length,
        linked,
      });
    }
    logger.info(`Initial job record ensured`);
    await setStage(jobId, "ocr");

    const allClaims: Claim[] = [];

    // ========== PROCESS ALL FILES (ALWAYS) ==========
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const docId = `${jobId}#${file.name}`;
      const fileStartTime = Date.now();

      console.log(`PROCESSING FILE ${i + 1}/${files.length}: ${file.name}`);

      try {
        await setStage(jobId, "ocr");
        logger.info(`Performing OCR`);

        const ocrStartTime = Date.now();
        const ocrText = await normalization(file);
        const ocrTime = Date.now() - ocrStartTime;

        console.log(`OCR completed in ${ocrTime}ms`);
        console.log(`OCR text length: ${ocrText.length} characters`);

        await setStage(jobId, "structure");
        logger.info(`Extracting document structure`);

        const structureStartTime = Date.now();
        try {
          await retrieveAndStoreStructure({
            jobId,
            docId,
            ocrText,
          });
          console.log(`Structure extraction completed`);
        } catch (structureError) {
          console.error(`Structure extraction failed:`, structureError);
        }
        const structureTime = Date.now() - structureStartTime;

        console.log(`Structure extraction time: ${structureTime}ms`);

        logger.info(`Reading structure from database`);

        const scanStartTime = Date.now();
        const docRecord = await getDocumentByDocId(docId);
        const scanTime = Date.now() - scanStartTime;

        logger.info(`Document record fetched in ${scanTime}ms`);

        let structure: DocumentStructure[] = [];

        if (docRecord?.structure) {
          structure = docRecord.structure;
        } else {
          console.log(`No structure found, creating simple structure`);
          structure = [
            {
              type: "document",
              text: ocrText,
              section: "main",
              level: 1,
            },
          ];
        }

        console.log(`Structure blocks available: ${structure.length}`);

        await setStage(jobId, "claims");
        logger.info(`Extracting claims with AI (intent="${DEFAULT_INTENT}")`);

        const claimsStartTime = Date.now();
        let extractedClaims: ExtractedClaim[] = [];

        try {
          extractedClaims = await extractClaims(
            {
              docId,
              intent: DEFAULT_INTENT,
              structure,
            },
            {
              apiKey: process.env.GROQ_API_KEY!,
              model: "meta-llama/llama-4-scout-17b-16e-instruct",
            },
          );
          console.log(`Claim extraction completed`);
        } catch (claimsError) {
          console.error(`Claim extraction failed:`, claimsError);
        }

        const claimsTime = Date.now() - claimsStartTime;

        console.log(`Claim extraction time: ${claimsTime}ms`);
        console.log(`Claims extracted: ${extractedClaims.length}`);

        logger.info(`Storing ${extractedClaims.length} claims`);

        const now = new Date().toISOString();
        const claimRows = [];
        for (let c = 0; c < extractedClaims.length; c++) {
          const extracted = extractedClaims[c];
          const claimId = `${docId}\u001F${c}`;

          const claim: Claim = {
            ...extracted,
            claimId,
            intent: DEFAULT_INTENT,
          };
          allClaims.push(claim);

          claimRows.push({
            id: claimId,
            job_id: jobId,
            doc_id: claim.docId,
            source_id: claim.sourceId,
            claim_type: claim.claimType,
            actor_role: claim.actorRole,
            actor_ref: claim.actorRef,
            claim_text: claim.claimText,
            intent: DEFAULT_INTENT,
            model: claim.model,
            provider: claim.provider,
            embedding: claim.embedding,
            created_at: now,
          });
        }

        await createClaims(claimRows as any);

        logger.info(`${extractedClaims.length} claims stored in database`);

        console.log(`Updating job progress`);
        console.log(`Processed files: ${i + 1}/${files.length}`);

        try {
          await updateJob(jobId, {
            progress: { processedFiles: i + 1, totalFiles: files.length },
          });
        } catch (updateError) {
          console.error(`Failed to update progress:`, updateError);
        }

        const fileTime = Date.now() - fileStartTime;
        console.log(`File ${i + 1} processed in ${fileTime}ms`);
      } catch (err) {
        console.error(`Failed processing ${file.name}`, err);
      }
    }

    console.log(`PROCESSING SUMMARY`);
    console.log(`Total claims extracted: ${allClaims.length}`);
    console.log(`Total files processed: ${files.length}`);

    // ========== ALWAYS GROUP CLAIMS BY DOCUMENT ==========
    console.log(`Grouping claims by document`);

    const grouped = new Map<string, Claim[]>();

    for (const claim of allClaims) {
      if (!grouped.has(claim.docId)) grouped.set(claim.docId, []);
      grouped.get(claim.docId)!.push(claim);
    }

    console.log(`Documents with claims: ${grouped.size}`);

    // ========== ALWAYS RUN INTRA-DOCUMENT ANALYSIS ==========
    logger.info(`Computing intra-document differences`);
    await setStage(jobId, "differences");

    const diffStartTime = Date.now();

    // Run intra-document analysis for each document
    for (const docId of Array.from(grouped.keys())) {
      try {
        await computeIntraDocumentDifferences(docId);
        console.log(`${docId}: Intra-document analysis completed`);
      } catch (err) {
        console.error(`Failed intra-document analysis for ${docId}:`, err);
      }
    }

    const diffTime = Date.now() - diffStartTime;
    console.log(`Intra-document analysis completed in ${diffTime}ms`);

    // ========== CONDITIONAL: CROSS-DOCUMENT ANALYSIS ==========
    let crossDocumentResults = null;

    if (linked && files.length > 1) {
      console.log(`CIDL ENABLED - Running cross-document analysis`);
      try {
        crossDocumentResults = await computeCrossDocumentDifferences(jobId);
        console.log(`Cross-document analysis completed`);
      } catch (error) {
        console.error(`Failed cross-document analysis:`, error);
        crossDocumentResults = null;
      }
    } else {
      console.log(`CIDL DISABLED - No cross-document analysis`);
    }

    // ========== GET ALL DIFFERENCES FOR ANALYSIS ==========
    console.log(`Getting all differences for analysis`);

    const allDifferences = await getDifferences(undefined, jobId);
    console.log(`Found ${allDifferences.length} total differences`);

    // Filter for contradictions and changes
    const contradictions = allDifferences.filter(
      (diff: Difference) =>
        diff.contradiction === true || diff.type === "contradiction",
    );
    const changes = allDifferences.filter(
      (diff: Difference) =>
        diff.type === "change" && diff.contradiction !== true,
    );

    logger.info(
      `Found ${contradictions.length} contradictions and ${changes.length} changes`,
    );

    // ========== CREATE FINDINGS ==========
    console.log(`Creating findings with color coding`);

    const groups: Group[] = [];

    // 1. CREATE CONTRADICTIONS GROUP (if any)
    if (contradictions.length > 0) {
      console.log(
        `Creating contradictions group with ${contradictions.length} contradictions`,
      );

      const contradictionFindings: Finding[] = contradictions.map(
        (diff: Difference) => ({
          id: diff.differenceId,
          type: "red",
          claimA: {
            document: diff.docAId || diff.docId,
            clause: diff.claimAType || "N/A",
            text: diff.claimAText,
          },
          claimB: {
            document: diff.docBId || diff.docId,
            clause: diff.claimBType || "N/A",
            text: diff.claimBText,
          },
          explanation: diff.explanation || "Contradiction detected",
        }),
      );

      groups.push({
        docId: "contradictions-group",
        name: linked
          ? "Cross-Document Contradictions"
          : "Document Contradictions",
        summary: {
          contradictions: contradictionFindings.length,
          changes: 0,
          obligations: 0,
          scope: 0,
        },
        findings: contradictionFindings,
      });

      logger.info(
        `Created contradictions group with ${contradictionFindings.length} findings`,
      );
    }

    // 1b. CREATE CHANGES GROUP (yellow findings)
    if (changes.length > 0) {
      const changeFindings: Finding[] = changes.map((diff: Difference) => ({
        id: diff.differenceId,
        type: "yellow",
        claimA: {
          document: diff.docAId || diff.docId,
          clause: diff.claimAType || "N/A",
          text: diff.claimAText,
        },
        claimB: {
          document: diff.docBId || diff.docId,
          clause: diff.claimBType || "N/A",
          text: diff.claimBText,
        },
        explanation: diff.explanation || "Wording or scope change detected",
      }));

      groups.push({
        docId: "changes-group",
        name: linked ? "Cross-Document Changes" : "Document Changes",
        summary: {
          contradictions: 0,
          changes: changeFindings.length,
          obligations: 0,
          scope: 0,
        },
        findings: changeFindings,
      });

      logger.info(
        `Created changes group with ${changeFindings.length} findings`,
      );
    }

    // 2. CREATE STANDALONE CLAIMS GROUPS FOR EACH DOCUMENT
    for (const [docId, claims] of Array.from(grouped.entries())) {
      const standaloneFindings: Finding[] = [];

      for (const claim of claims) {
        // Skip if claim is already in a contradiction or change finding.
        const isInContradiction = contradictions.some(
          (diff: Difference) =>
            diff.claimAText === claim.claimText ||
            diff.claimBText === claim.claimText,
        );
        const isInChange = changes.some(
          (diff: Difference) =>
            diff.claimAText === claim.claimText ||
            diff.claimBText === claim.claimText,
        );

        if (!isInContradiction && !isInChange) {
          standaloneFindings.push({
            id: claim.claimId,
            type: "green",
            claimA: {
              document: claim.docId,
              clause: claim.claimType || claim.intent,
              text: claim.claimText,
            },
            explanation: "Standalone claim",
          });
        }
      }

      if (standaloneFindings.length > 0) {
        const docName = extractDocumentName(docId);
        groups.push({
          docId,
          name: `Standalone Claims - ${docName}`,
          summary: {
            contradictions: 0,
            changes: 0,
            obligations: claims.filter((c) => c.claimType === "obligation")
              .length,
            scope: claims.filter((c) => c.claimType === "scope").length,
          },
          findings: standaloneFindings,
        });

        console.log(
          `Created standalone group for ${docId} with ${standaloneFindings.length} claims`,
        );
      }
    }

    // 3. IF NO GROUPS AT ALL (no contradictions and no standalone claims), create empty groups
    if (groups.length === 0) {
      console.log(`No findings created, creating empty document groups`);

      for (const [docId, claims] of Array.from(grouped.entries())) {
        groups.push({
          docId,
          name: "Document Claims",
          summary: {
            contradictions: 0,
            changes: 0,
            obligations: claims.filter((c) => c.claimType === "obligation")
              .length,
            scope: claims.filter((c) => c.claimType === "scope").length,
          },
          findings: [],
        });
      }
    }

    console.log(`Created ${groups.length} total groups`);

    // ========== FINAL RESULT WRITE ==========
    console.log(`Writing final results to database`);

    const totalFindings = groups.reduce((sum, g) => sum + g.findings.length, 0);
    console.log(`Total findings: ${totalFindings}`);

    const completionUpdates: any = {
      status: "completed",
      stage: "completed",
      result: {
        groups,
        summary: {
          totalClaims: allClaims.length,
          totalDocuments: files.length,
          totalContradictions: groups.reduce(
            (sum, g) => sum + g.summary.contradictions,
            0,
          ),
          totalChanges: groups.reduce((sum, g) => sum + g.summary.changes, 0),
          cidlEnabled: linked,
          processingTime: Date.now() - startTime,
        },
      },
      completed_at: new Date().toISOString(),
    };

    // Only clear files payload when the column exists in this deployment schema.
    const completionJob = await getJob(jobId);
    if (completionJob && "files" in completionJob) {
      completionUpdates.files = null;
    }

    await updateJob(jobId, completionUpdates);

    const totalTime = Date.now() - startTime;
    console.log(`PROCESSING COMPLETE`);
    console.log(`Total processing time: ${totalTime}ms`);
    console.log(`Files processed: ${files.length}`);
    console.log(`Claims extracted: ${allClaims.length}`);
    console.log(`Groups created: ${groups.length}`);
    console.log(`CIDL Enabled: ${linked}`);
    console.log(
      `Total contradictions: ${groups.reduce((sum, g) => sum + g.summary.contradictions, 0)}`,
    );
    console.log(
      `Total changes: ${groups.reduce((sum, g) => sum + g.summary.changes, 0)}`,
    );
  } catch (err: any) {
    console.error(`PROCESSING FAILED`);
    console.error(`Job ID: ${jobId}`);
    console.error(`Error:`, err);

    const totalTime = Date.now() - startTime;
    console.error(`Failed after: ${totalTime}ms`);

    try {
      await updateJob(jobId, {
        status: "failed",
        stage: "failed",
        error: err?.message ?? "Unknown error",
        failed_at: new Date().toISOString(),
      });
      console.log(`Job status updated to 'failed' in database`);
    } catch (updateError) {
      console.error(`Failed to update job status:`, updateError);
    }
  }
}
