/**
 * lib/difference.ts
 *
 * Contradiction / change detection between extracted claims.
 *
 * Pipeline:
 *  1. Load claims (with embeddings) from Supabase.
 *  2. Build candidate pairs via brute-force cosine over embeddings.
 *  3. Auto-classify trivially-similar (>0.92) and trivially-different (<0.30) pairs.
 *  4. Send the remaining ambiguous pairs to the Groq LLM in batches.
 *  5. Persist results in the differences table.
 *
 * Falls back to text-similarity + regex heuristics if embeddings are missing
 * or the LLM is unavailable.
 */

import crypto from "node:crypto";
import {
  getClaimsByDocId as dbGetClaimsByDocId,
  getClaimsByJobId as dbGetClaimsByJobId,
  createDifferences,
  getDifferencesByJobId,
  getDifferencesByDocId,
} from "@/lib/db";
import { cosineSimilarity, EMBEDDING_DIM } from "@/lib/embeddings";
import { logger } from "@/lib/logger";

/* ---------------- Types ---------------- */

export interface Claim {
  docId: string;
  claimId: string;
  claimText: string;
  claimType: string;
  intent?: string;
  position?: number;
  createdAt?: number;
  model?: string;
  provider?: string;
  embedding?: number[];
  jobId?: string;
}

export type RelationshipType =
  | "contradiction"
  | "consistency"
  | "complementary"
  | "similarity"
  | "change"
  | "obligation";

export interface Difference {
  docId: string;
  differenceId: string;
  type: RelationshipType;
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
  contradiction: boolean;
}

interface ClaimPair {
  pairId: string;
  a: Claim;
  b: Claim;
  cosineSim: number; // [-1, 1]
}

interface ComparisonResult {
  pairId: string;
  contradiction: boolean;
  similarityScore: number; // 0-100
  relationship: RelationshipType;
  explanation: string;
}

/* ---------------- Tunables ---------------- */

const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const LLM_BATCH_SIZE = 5;
const TOP_K_NEIGHBORS = 10;

// Cosine-similarity thresholds (vectors are unit-normalized).
const SIM_AUTO_SIMILAR = 0.92; // ≥ → auto-classify "similarity", skip LLM
const SIM_COMPARE_MIN = 0.55; // ≥ → send to LLM
const SIM_AUTO_SKIP = 0.3; // < → too unrelated, skip

/* ---------------- Utils ---------------- */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function generatePairId(a: Claim, b: Claim): string {
  // Order-independent so (a,b) and (b,a) hash to the same id.
  const [first, second] = [
    `${a.docId}|${a.claimId}`,
    `${b.docId}|${b.claimId}`,
  ].sort();
  const raw = `${first}::${second}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function extractJobId(claim: Claim): string {
  if (claim.jobId) return claim.jobId;
  // docId is `${jobId}#${file.name}` — take the prefix.
  const idx = claim.docId.indexOf("#");
  return idx > 0 ? claim.docId.slice(0, idx) : claim.docId;
}

function extractDocumentName(docId: string): string {
  const idx = docId.indexOf("#");
  return idx >= 0 ? docId.slice(idx + 1) : docId;
}

/* ---------------- DB: Read claims ---------------- */

async function getClaims(docId: string): Promise<Claim[]> {
  return dbGetClaimsByDocId(docId);
}

async function _getClaimsByJobId(jobId: string): Promise<Claim[]> {
  return dbGetClaimsByJobId(jobId);
}

/* ---------------- Pre-filter: Brute-force cosine pairs ---------------- */

/**
 * Build claim pairs using brute-force cosine similarity.
 * Small docs (< 500 claims) run fast enough; for large docs pgvector
 * can be swapped in later.
 */
async function buildPairs(
  claims: Claim[],
  options: { sameDocOnly?: boolean; crossDocOnly?: boolean } = {},
): Promise<ClaimPair[]> {
  if (claims.length < 2) return [];
  return buildPairsBruteForce(claims, options);
}

function buildPairsBruteForce(
  claims: Claim[],
  options: { sameDocOnly?: boolean; crossDocOnly?: boolean } = {},
): ClaimPair[] {
  const pairs: ClaimPair[] = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      if (options.sameDocOnly && a.docId !== b.docId) continue;
      if (options.crossDocOnly && a.docId === b.docId) continue;

      const sim = pairCosine(a, b);
      if (sim < SIM_AUTO_SKIP) continue;

      pairs.push({ pairId: generatePairId(a, b), a, b, cosineSim: sim });
    }
  }
  return pairs;
}

function pairCosine(a: Claim, b: Claim): number {
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    return cosineSimilarity(a.embedding, b.embedding);
  }
  // Fallback: lexical Jaccard scaled to [0,1]
  return jaccardSimilarity(a.claimText, b.claimText);
}

function jaccardSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(
    textA
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
  const wordsB = new Set(
    textB
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2),
  );
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  wordsA.forEach((w) => {
    if (wordsB.has(w)) inter++;
  });
  const union = wordsA.size + wordsB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/* ---------------- LLM prompt + call ---------------- */

function buildRelationshipPrompt(batch: ClaimPair[]): string {
  return `You are a senior legal-document analyst comparing pairs of clauses.

Your job is to decide whether each pair represents a CONTRADICTION, a CHANGE, or
something benign. Undetected contradictions are far more costly than
false positives, so when a pair is on the boundary between "change" and
"contradiction", lean toward "contradiction".

Decision rubric — apply IN ORDER, stop at the first that matches:

1. CONTRADICTION — the claims cannot both be true at once. Triggers include:
     • Different numeric thresholds for the SAME requirement
       (e.g. "within 30 days" vs "within 60 days";
              "$100,000 cap"  vs "$1,000,000 cap";
              "5%"            vs "10%").
     • Modal flip: must vs must not, shall vs shall not, required vs optional,
       can vs cannot, will vs will not.
     • Opposite scope: "all customers" vs "no customers"; "domestic only" vs
       "international only".
     Set contradiction=true and relationship="contradiction".

2. CHANGE — same topic and same overall intent, but the wording, scope, or
   conditions have been MEANINGFULLY UPDATED, AMENDED, or REWORDED in a way
   that a reviewer should notice (e.g. tightening, loosening, adding a
   carve-out, renaming a party, narrowing a definition).
   Set contradiction=false and relationship="change".

3. COMPLEMENTARY — different aspects of the same policy that together form a
   complete picture (e.g. one defines a fee, the other defines when it
   applies). Set relationship="complementary".

4. SIMILARITY — identical meaning, only superficial wording differences.
   Set relationship="similarity".

5. CONSISTENCY — the claims agree but cover slightly different ground.
   Set relationship="consistency".

6. OBLIGATION — both are unrelated obligations that happen to use similar
   words. Set relationship="obligation".

similarityScore must be 0-100. contradiction is a boolean. explanation is
1-2 sentences in plain English, citing the specific words/numbers that
drove the decision.

EXAMPLES

Example A:
  ClaimA: "Payment must be made within 30 days for domestic orders."
  ClaimB: "Payment must be made within 60 days for domestic orders."
  → { "contradiction": true, "relationship": "contradiction",
       "similarityScore": 92,
       "explanation": "Same obligation (domestic payment timeline) with
                       conflicting deadlines: 30 vs 60 days." }

Example B:
  ClaimA: "Liability is capped at $100,000 for normal claims."
  ClaimB: "Liability is capped at $1,000,000 for willful misconduct."
  → { "contradiction": false, "relationship": "change",
       "similarityScore": 75,
       "explanation": "Both cap liability but apply to different fault
                       categories; the cap was raised for willful misconduct,
                       a meaningful amendment." }

Example C:
  ClaimA: "The warranty period is 1 year for basic license."
  ClaimB: "The warranty period is 2 years for basic license."
  → { "contradiction": true, "relationship": "contradiction",
       "similarityScore": 95,
       "explanation": "Conflicting warranty durations for the same license
                       tier (1 year vs 2 years)." }

Example D:
  ClaimA: "Tenant must vacate by the 1st of the month."
  ClaimB: "Tenant must not vacate before the 5th of the month."
  → { "contradiction": true, "relationship": "contradiction",
       "similarityScore": 80,
       "explanation": "The two clauses impose mutually exclusive vacate
                       deadlines (by the 1st vs not before the 5th)." }

Respond ONLY with a JSON object of the form:
{ "results": [ { "pairId": "...", "contradiction": false,
                 "relationship": "...", "similarityScore": 0,
                 "explanation": "..." } ] }
The results array MUST contain exactly one entry per input pair, in order.

Pairs to evaluate:
${batch
  .map(
    (p) => `
PairId: ${p.pairId}
DocA: ${extractDocumentName(p.a.docId)}
DocB: ${extractDocumentName(p.b.docId)}
ClaimA (${p.a.claimType}): "${p.a.claimText}"
ClaimB (${p.b.claimType}): "${p.b.claimText}"`,
  )
  .join("\n")}
`;
}

async function analyzeClaimRelationshipsBatch(
  batch: ClaimPair[],
): Promise<ComparisonResult[]> {
  if (batch.length === 0) return [];

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    logger.warn("[DIFF] GROQ_API_KEY not set — using fallback heuristics.");
    return generateFallbackResults(batch);
  }

  const prompt = buildRelationshipPrompt(batch);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a senior legal-document analyst trained to surface " +
              "contradictions, amendments, and meaningful changes between " +
              "clauses. You never gloss over numeric or modal differences " +
              "(e.g. 30 vs 60 days, must vs must not, $100k vs $1M). " +
              "When two clauses cover the same obligation but with different " +
              "numbers or modal verbs, you ALWAYS flag a contradiction. " +
              "You always respond with valid JSON in the exact schema requested.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      logger.error(`[DIFF] Groq API error: ${res.status} ${res.statusText}`);
      return generateFallbackResults(batch);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn("[DIFF] No content in AI response");
      return generateFallbackResults(batch);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      logger.error("[DIFF] Failed to parse AI response:", err);
      return generateFallbackResults(batch);
    }

    const obj = parsed as Record<string, unknown>;
    const results: any[] = Array.isArray(obj)
      ? (obj as any[])
      : Array.isArray(obj.results)
        ? (obj.results as any[])
        : Array.isArray(obj.relationships)
          ? (obj.relationships as any[])
          : [];

    if (results.length === 0) {
      logger.warn("[DIFF] AI returned empty results");
      return generateFallbackResults(batch);
    }

    return results.map((r: any, idx: number) => {
      const pair =
        batch.find((p) => p.pairId === r.pairId) ?? batch[idx] ?? batch[0];
      const cosScore = pair ? Math.round(pair.cosineSim * 100) : 50;

      let contradiction = r.contradiction === true;
      let relationship: RelationshipType =
        (r.relationship as RelationshipType) ||
        (contradiction ? "contradiction" : "consistency");
      let explanation = r.explanation || "Analyzed by AI";

      // Safety net: if the LLM said the claims AGREE (consistency / similarity)
      // but our deterministic regex checks find an obvious modal/numeric/
      // duration conflict, override the LLM. We do NOT override when the LLM
      // said "change", "complementary", or "obligation" — those carry topical
      // context the regex cannot see (e.g. different fault categories).
      const llmSaysAgree =
        relationship === "consistency" || relationship === "similarity";
      if (pair && !contradiction && llmSaysAgree) {
        const a = pair.a.claimText;
        const b = pair.b.claimText;
        let regexHit: string | null = null;
        if (detectModalContradiction(a, b))
          regexHit = "modal verb (must vs must not)";
        else if (detectDurationContradiction(a, b))
          regexHit = "duration / timeframe";
        else if (detectNumericContradiction(a, b)) regexHit = "numeric value";

        if (regexHit) {
          contradiction = true;
          relationship = "contradiction";
          explanation = `Conflicting ${regexHit} detected (regex override of LLM "${r.relationship}" verdict).`;
          logger.info(
            `[DIFF] Regex override on pair ${pair.pairId}: ${regexHit}`,
          );
        }
      }

      return {
        pairId: r.pairId ?? pair.pairId,
        contradiction,
        similarityScore:
          typeof r.similarityScore === "number" ? r.similarityScore : cosScore,
        relationship,
        explanation,
      };
    });
  } catch (error) {
    clearTimeout(timeoutId);
    logger.error("[DIFF] AI analysis failed:", error);
    return generateFallbackResults(batch);
  }
}

/* ---------------- Fallback heuristics ---------------- */

const NEGATION_PAIRS: [RegExp, RegExp][] = [
  [/\bmust\b/i, /\bmust\s+not\b/i],
  [/\bshall\b/i, /\bshall\s+not\b/i],
  [/\bwill\b/i, /\bwill\s+not\b/i],
  [/\bmay\b/i, /\bmay\s+not\b/i],
  [/\bshould\b/i, /\bshould\s+not\b/i],
  [/\bcan\b/i, /\bcannot\b|\bcan\s+not\b/i],
  [/\brequired\b/i, /\bnot\s+required\b/i],
  [/\bpermitted\b/i, /\bnot\s+permitted\b|\bprohibited\b/i],
];

function detectModalContradiction(a: string, b: string): boolean {
  for (const [pos, neg] of NEGATION_PAIRS) {
    if ((pos.test(a) && neg.test(b)) || (neg.test(a) && pos.test(b)))
      return true;
  }
  return false;
}

function extractNumbers(text: string): string[] {
  const matches =
    text.match(/\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?\s*%|\b\d+\b/g) ?? [];
  return matches;
}

function extractDurations(text: string): string[] {
  const matches =
    text.match(
      /\b\d+\s*(?:second|minute|hour|day|week|month|quarter|year)s?\b/gi,
    ) ?? [];
  return matches.map((s) => s.toLowerCase().replace(/\s+/g, " "));
}

function detectNumericContradiction(a: string, b: string): boolean {
  const numsA = extractNumbers(a);
  const numsB = extractNumbers(b);
  if (numsA.length === 0 || numsB.length === 0) return false;
  // If they share none of the numeric values, treat as contradiction candidate.
  const setB = new Set(numsB);
  return !numsA.some((n) => setB.has(n));
}

function detectDurationContradiction(a: string, b: string): boolean {
  const dursA = extractDurations(a);
  const dursB = extractDurations(b);
  if (dursA.length === 0 || dursB.length === 0) return false;
  const setB = new Set(dursB);
  return !dursA.some((d) => setB.has(d));
}

function generateFallbackResults(batch: ClaimPair[]): ComparisonResult[] {
  return batch.map((pair) => {
    const a = pair.a.claimText;
    const b = pair.b.claimText;
    const sim = pair.cosineSim;
    const score = Math.round(sim * 100);

    let contradiction = false;
    let relationship: RelationshipType = "consistency";
    let explanation = "No contradiction detected (heuristic).";

    if (sim >= SIM_AUTO_SIMILAR) {
      relationship = "similarity";
      explanation = "Claims express the same idea (cosine ≥ 0.92).";
    } else if (sim >= SIM_COMPARE_MIN) {
      // Run cheap regex checks
      if (detectModalContradiction(a, b)) {
        contradiction = true;
        relationship = "contradiction";
        explanation = "Conflicting modal verb (e.g., must vs must not).";
      } else if (detectDurationContradiction(a, b)) {
        contradiction = true;
        relationship = "contradiction";
        explanation = "Conflicting durations / timeframes.";
      } else if (detectNumericContradiction(a, b)) {
        contradiction = true;
        relationship = "contradiction";
        explanation = "Conflicting numeric values.";
      } else if (pair.a.claimType !== pair.b.claimType) {
        relationship = "complementary";
        explanation = "Related claims of different types.";
      } else {
        relationship = "change";
        explanation = "Same topic, possibly amended wording.";
      }
    }

    return {
      pairId: pair.pairId,
      contradiction,
      similarityScore: score,
      relationship,
      explanation,
    };
  });
}

/* ---------------- DB: Write differences ---------------- */

async function writeDifferencesBatch(
  results: ComparisonResult[],
  pairs: ClaimPair[],
): Promise<void> {
  if (results.length === 0 || pairs.length === 0) return;

  const pairById = new Map(pairs.map((p) => [p.pairId, p]));
  const now = new Date().toISOString();

  const diffs = results
    .map((result) => {
      const pair = pairById.get(result.pairId);
      if (!pair) return null;
      return {
        id: result.pairId,
        job_id: extractJobId(pair.a),
        doc_id: pair.a.docId,
        type: result.relationship,
        claim_a_id: pair.a.claimId,
        claim_b_id: pair.b.claimId,
        claim_a_text: pair.a.claimText,
        claim_b_text: pair.b.claimText,
        claim_a_type: pair.a.claimType,
        claim_b_type: pair.b.claimType,
        doc_a_id: pair.a.docId,
        doc_b_id: pair.b.docId,
        similarity_score: result.similarityScore,
        explanation: result.explanation,
        contradiction: result.contradiction,
        created_at: now,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  await createDifferences(diffs as any);
}

/* ---------------- Auto-classification helpers ---------------- */

function autoClassify(pair: ClaimPair): ComparisonResult | null {
  // Only auto-classify trivially-similar pairs to skip the LLM call.
  if (pair.cosineSim >= SIM_AUTO_SIMILAR) {
    return {
      pairId: pair.pairId,
      contradiction: false,
      similarityScore: Math.round(pair.cosineSim * 100),
      relationship: "similarity",
      explanation: "Claims are near-duplicates (cosine ≥ 0.92).",
    };
  }
  return null;
}

/**
 * Split pairs into auto-resolved (cheap) and ambiguous (need LLM).
 */
function partitionPairs(pairs: ClaimPair[]) {
  const auto: ComparisonResult[] = [];
  const ambiguous: ClaimPair[] = [];
  for (const p of pairs) {
    const r = autoClassify(p);
    if (r) auto.push(r);
    else if (p.cosineSim >= SIM_COMPARE_MIN) ambiguous.push(p);
    // else: below SIM_COMPARE_MIN — drop entirely (already filtered in buildPairs)
  }
  return { auto, ambiguous };
}

/* ---------------- Public: intra-document differences ---------------- */

export async function computeIntraDocumentDifferences(
  docId: string,
): Promise<number> {
  logger.info(`[DIFF] Intra-document analysis for ${docId}`);

  try {
    const claims = await getClaims(docId);
    if (claims.length < 2) {
      logger.info(`[DIFF] Need ≥2 claims; have ${claims.length}. Skip.`);
      return 0;
    }

    const pairs = await buildPairs(claims, { sameDocOnly: true });
    if (pairs.length === 0) return 0;

    const { auto, ambiguous } = partitionPairs(pairs);
    logger.info(
      `[DIFF] ${pairs.length} pairs: ${auto.length} auto-resolved, ${ambiguous.length} → LLM`,
    );

    let totalContradictions = auto.filter((r) => r.contradiction).length;
    if (auto.length > 0) {
      const autoPairs = pairs.filter((p) =>
        auto.some((r) => r.pairId === p.pairId),
      );
      await writeDifferencesBatch(auto, autoPairs);
    }

    for (const batch of chunk(ambiguous, LLM_BATCH_SIZE)) {
      const results = await analyzeClaimRelationshipsBatch(batch);
      await writeDifferencesBatch(results, batch);
      totalContradictions += results.filter((r) => r.contradiction).length;
    }

    logger.info(`[DIFF] ${docId}: ${totalContradictions} contradictions found`);
    return totalContradictions;
  } catch (err) {
    logger.error(`[DIFF] Intra-doc failed for ${docId}:`, err);
    return 0;
  }
}

/* ---------------- Public: cross-document differences ---------------- */

export async function computeCrossDocumentDifferences(
  jobId: string,
): Promise<number> {
  logger.info(`[DIFF] Cross-document analysis for job ${jobId}`);

  try {
    const claims = await _getClaimsByJobId(jobId);
    if (claims.length < 2) return 0;

    const pairs = await buildPairs(claims, { crossDocOnly: true });
    if (pairs.length === 0) return 0;

    const { auto, ambiguous } = partitionPairs(pairs);
    logger.info(
      `[DIFF] ${pairs.length} cross-doc pairs: ${auto.length} auto, ${ambiguous.length} → LLM`,
    );

    let totalContradictions = auto.filter((r) => r.contradiction).length;
    if (auto.length > 0) {
      const autoPairs = pairs.filter((p) =>
        auto.some((r) => r.pairId === p.pairId),
      );
      await writeDifferencesBatch(auto, autoPairs);
    }

    for (const batch of chunk(ambiguous, LLM_BATCH_SIZE)) {
      const results = await analyzeClaimRelationshipsBatch(batch);
      await writeDifferencesBatch(results, batch);
      totalContradictions += results.filter((r) => r.contradiction).length;
    }

    return totalContradictions;
  } catch (err) {
    logger.error(`[DIFF] Cross-doc analysis failed:`, err);
    return 0;
  }
}

/* ---------------- Public: queries ---------------- */

export async function getDifferences(
  docId?: string,
  jobId?: string,
): Promise<Difference[]> {
  try {
    if (docId) {
      const rows = await getDifferencesByDocId(docId);
      return rows as unknown as Difference[];
    }
    if (jobId) {
      const rows = await getDifferencesByJobId(jobId);
      return rows as unknown as Difference[];
    }
    return [];
  } catch (err) {
    logger.error(`[DIFF] getDifferences failed:`, err);
    return [];
  }
}

export async function getContradictionsSummary(jobId: string) {
  const all = await getDifferences(undefined, jobId);
  const contradictions = all.filter(
    (d) => d.contradiction || d.type === "contradiction",
  );

  const byPair: Record<string, number> = {};
  const details = contradictions.map((d) => {
    const key = `${d.docAId}::${d.docBId}`;
    byPair[key] = (byPair[key] || 0) + 1;
    return {
      pairId: d.differenceId,
      claimAId: d.claimAId,
      claimBId: d.claimBId,
      claimAText: d.claimAText,
      claimBText: d.claimBText,
      explanation: d.explanation,
      similarityScore: d.similarityScore,
    };
  });

  return {
    totalContradictions: contradictions.length,
    contradictionsByDocumentPair: byPair,
    contradictionDetails: details,
  };
}

/* Re-exports for back-compat with existing imports */
export {
  detectModalContradiction,
  detectNumericContradiction,
  detectDurationContradiction,
};
