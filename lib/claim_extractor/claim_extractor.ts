import { z } from "zod";
import { generateEmbeddings } from "../embeddings";
import { logger } from "../logger";

// EXPANDED ActorRole type to be more flexible
export type ActorRole =
  | "document_owner"
  | "recipient"
  | "partner"
  | "data_subject"
  | "controller"
  | "processor"
  | "unspecified"
  | string; // ADD THIS - allow any string

export type ClaimType =
  | "obligation"
  | "prohibition"
  | "permission"
  | "definition"
  | "scope"
  | "procedure"
  | "legal_basis"
  | string; // ADD THIS - allow any string

export type StructureBlock = {
  type: string;
  id?: string;
  title?: string;
  text: string;
};

export type ClaimInput = {
  docId: string;
  intent: string;
  structure: StructureBlock[];
};

export type ExtractedClaim = {
  docId: string;
  sourceId?: string;
  claimType: string;
  actorRole: string;
  actorRef?: string;
  claimText: string;
  model: string;
  provider: "groq";
  embedding?: number[]; // 384-dim unit-normalized vector
};

const BATCH_SIZE = 5;

// NORMALIZATION FUNCTION - ADD THIS
function normalizeActorRole(role: string): string {
  if (!role) return "unspecified";

  const roleLower = role.toLowerCase().trim();

  // Map common variations to standard roles
  const roleMap: Record<string, string> = {
    // Management/Staff roles
    "management staff": "management",
    management_staff: "management",
    staff: "employee",
    employees: "employee",
    management: "management",
    manager: "management",
    administrator: "admin",
    "administrative staff": "admin",

    // Company/Organization roles
    company: "organization",
    organization: "organization",
    firm: "organization",
    corporation: "organization",
    entity: "organization",

    // Standard roles (keep as is)
    document_owner: "document_owner",
    recipient: "recipient",
    partner: "partner",
    data_subject: "data_subject",
    controller: "controller",
    processor: "processor",
    unspecified: "unspecified",

    // Legal roles
    "data controller": "controller",
    "data processor": "processor",
    "joint controller": "controller",
    "sub-processor": "processor",

    // Person roles
    individual: "data_subject",
    user: "data_subject",
    customer: "data_subject",
    client: "data_subject",
    employee: "employee",
    worker: "employee",
  };

  return roleMap[roleLower] || roleLower.replace(/\s+/g, "_");
}

function normalizeClaimType(claimType: string): string {
  if (!claimType) return "obligation";

  const typeLower = claimType.toLowerCase().trim();

  const typeMap: Record<string, string> = {
    obligations: "obligation",
    obligation: "obligation",
    prohibitions: "prohibition",
    prohibition: "prohibition",
    permissions: "permission",
    permission: "permission",
    definitions: "definition",
    definition: "definition",
    scope: "scope",
    scoping: "scope",
    procedures: "procedure",
    procedure: "procedure",
    legal_basis: "legal_basis",
    "legal basis": "legal_basis",
    requirement: "obligation",
    requirements: "obligation",
    must: "obligation",
    shall: "obligation",
    will: "obligation",
    should: "permission",
    may: "permission",
    cannot: "prohibition",
    "must not": "prohibition",
    "shall not": "prohibition",
  };

  return typeMap[typeLower] || "obligation";
}

// FLEXIBLE SCHEMA - CHANGED
const ClaimResultSchema = z.object({
  sourceId: z.string().default(""),
  hasClaim: z.boolean().default(false),
  claimType: z.string().default("obligation"),
  actorRole: z.string().default("unspecified"),
  actorRef: z.string().optional().default(""),
  claimText: z.string().default(""),
});

const ClaimResponseSchema = z.object({
  results: z.array(ClaimResultSchema).default([]),
});

export type GroqClientConfig = {
  apiKey: string;
  model: string;
  maxRetries?: number;
};

// Always enable debugging
const DEBUG_ENABLED = true;

function analyzeTextForComparisons(text: string): void {
  const comparisonIndicators = [
    "while",
    "whereas",
    "however",
    "in contrast",
    "on the other hand",
    "alternatively",
    "versus",
    "vs",
    "compared to",
    "different from",
    "unlike",
    "contrary to",
    "option",
    "alternative",
    "scenario",
    "first",
    "second",
    "third",
    "one",
    "another",
    "other",
  ];

  const contradictions = [
    "must",
    "must not",
    "shall",
    "shall not",
    "cannot",
    "can",
    "may",
    "may not",
    "will",
    "will not",
    "should",
    "should not",
  ];

  console.log(
    `Text preview: "${text.substring(0, 100)}${text.length > 100 ? "..." : ""}"`,
  );

  const lowerText = text.toLowerCase();

  let foundIndicators: string[] = [];
  comparisonIndicators.forEach((indicator) => {
    if (lowerText.includes(indicator.toLowerCase())) {
      foundIndicators.push(indicator);
    }
  });

  if (foundIndicators.length > 0) {
    console.log(`Comparison indicators found: ${foundIndicators.join(", ")}`);
  }

  contradictions.forEach((word) => {
    const regex = new RegExp(`\\b${word}\\b`, "gi");
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      console.log(
        `Contradiction word "${word}": ${matches.length} occurrences`,
      );
    }
  });

  // Look for numeric differences
  const numberPatterns = text.match(
    /\$\d+(?:,\d+)*(?:\.\d+)?|\d+\s*(?:days?|months?|years?|%)/gi,
  );
  if (numberPatterns && numberPatterns.length > 1) {
    console.log(`Multiple numeric values found: ${numberPatterns.join(", ")}`);
  }

  // Look for quoted text (often contains claims)
  const quotedText = text.match(/"[^"]+"/g);
  if (quotedText) {
    console.log(`Quoted text found: ${quotedText.length} quotes`);
    quotedText.forEach((quote, i) => {
      console.log(
        `  Quote ${i + 1}: "${quote.substring(0, 50)}${quote.length > 50 ? "..." : ""}"`,
      );
    });
  }
}

export async function extractClaims(
  input: ClaimInput,
  config: GroqClientConfig,
): Promise<ExtractedClaim[]> {
  const { docId, intent, structure } = input;
  const { apiKey, model, maxRetries = 3 } = config;

  console.log(`STARTING CLAIM EXTRACTION`);
  console.log(`Document ID: ${docId}`);
  console.log(`Intent: "${intent}"`);
  console.log(`Structure blocks: ${structure.length}`);
  console.log(`Model: ${model}`);

  structure.slice(0, 3).forEach((block, i) => {
    console.log(`\n=== Block ${i} Analysis ===`);
    analyzeTextForComparisons(block.text);
  });

  const claims: ExtractedClaim[] = [];

  for (let i = 0; i < structure.length; i += BATCH_SIZE) {
    const batch = structure.slice(i, i + BATCH_SIZE);
    const prompt = buildPrompt(intent, batch);

    console.log(
      `BATCH ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(structure.length / BATCH_SIZE)}`,
    );
    console.log(`Batch size: ${batch.length} blocks`);

    let attempt = 0;
    let raw = "";

    while (attempt < maxRetries) {
      attempt++;
      console.log(`ATTEMPT ${attempt}/${maxRetries}`);

      try {
        raw = await callGroqApi(prompt, apiKey, model);

        console.log(`Raw response: ${raw.length} characters`);

        // CLEAN NON-JSON TEXT
        const originalRaw = raw;

        raw = raw
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .replace(/\n```/g, "")
          .trim();

        // Find JSON start
        const jsonStart = raw.search(/[\{\[]/);
        if (jsonStart > 0) {
          console.log(
            `Found non-JSON text at beginning, removing ${jsonStart} characters`,
          );
          raw = raw.substring(jsonStart);
        }

        // Find JSON end
        const jsonEnd = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
        if (jsonEnd !== -1 && jsonEnd < raw.length - 1) {
          raw = raw.substring(0, jsonEnd + 1);
        }

        // Fix JSON formatting
        raw = raw
          .replace(/,\s*}/g, "}")
          .replace(/,\s*\]/g, "]")
          .trim();

        // Fix malformed JSON
        if (raw.startsWith("[") && raw.endsWith("}")) {
          raw = raw.slice(0, raw.lastIndexOf("}")).trim();
          if (!raw.endsWith("]")) {
            raw = raw + "]";
          }
        }

        console.log(`Cleaned response length: ${raw.length}`);

        let parsedResult;
        try {
          const jsonValue = JSON.parse(raw);
          console.log("Successfully parsed JSON");

          // NORMALIZE BEFORE VALIDATION - ADD THIS STEP
          let normalizedData = jsonValue;

          // If it's an array, wrap in results object
          if (Array.isArray(jsonValue)) {
            normalizedData = { results: jsonValue };
          }

          // Normalize each result
          if (normalizedData.results && Array.isArray(normalizedData.results)) {
            normalizedData.results = normalizedData.results.map(
              (result: any) => ({
                ...result,
                actorRole: normalizeActorRole(
                  result.actorRole || "unspecified",
                ),
                claimType: normalizeClaimType(result.claimType || "obligation"),
                claimText: result.claimText || "",
                actorRef: result.actorRef || "",
                sourceId: result.sourceId || "",
                hasClaim: Boolean(result.hasClaim),
              }),
            );
          }

          parsedResult = ClaimResponseSchema.safeParse(normalizedData);

          if (parsedResult.success) {
            console.log("Schema validation passed");
          } else {
            console.log("Schema validation failed");
            if (parsedResult.error) {
              parsedResult.error.errors.forEach((err, idx) => {
                console.error(`Error ${idx + 1}:`, {
                  path: err.path?.join(".") || "unknown",
                  message: err.message,
                });
              });
            }
          }
        } catch (parseError) {
          console.error("JSON Parse Error:", parseError);
          console.error(
            "Problematic raw text (first 500 chars):",
            raw.substring(0, 500),
          );
          throw new Error(`Malformed JSON from claim extractor`);
        }

        if (!parsedResult.success) {
          console.error("Invalid claim extractor response shape");
          // Instead of throwing, return empty array for this batch
          console.log("Skipping this batch due to validation errors");
          break;
        }

        const results = parsedResult.data.results;
        console.log(`Extracted ${results.length} results from batch`);

        let batchClaims = 0;
        for (const r of results) {
          if (!r.hasClaim || !r.claimText) {
            continue;
          }
          // skip empty/whitespace-only claim text
          if (!r.claimText.trim()) continue;

          claims.push({
            docId,
            sourceId: r.sourceId || undefined,
            claimType: r.claimType,
            actorRole: r.actorRole,
            actorRef: r.actorRef || undefined,
            claimText: r.claimText,
            model,
            provider: "groq",
          });

          batchClaims++;
          console.log(
            `Added claim ${batchClaims}: ${r.claimType} - "${r.claimText.substring(0, 50)}..."`,
          );
        }

        console.log(
          `Batch ${Math.floor(i / BATCH_SIZE) + 1} complete: Added ${batchClaims} claims`,
        );
        break; // Success, exit retry loop
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err);

        if (attempt === maxRetries) {
          console.error(`Claim extraction failed after ${maxRetries} attempts`);
          console.error("Last error:", err);
          // Don't throw, just continue with next batch
          console.log("Continuing with next batch...");
          break;
        }

        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Waiting ${delay}ms before retry ${attempt + 1}...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  logger.info(`EXTRACTION COMPLETE - raw claims: ${claims.length}`);

  // ===== DEDUPLICATION =====
  const seen = new Set<string>();
  const dedupedClaims: ExtractedClaim[] = [];
  for (const c of claims) {
    const key = c.claimText.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedClaims.push(c);
  }
  logger.info(
    `Deduplicated: ${claims.length} -> ${dedupedClaims.length} (removed ${claims.length - dedupedClaims.length} duplicates)`,
  );

  // ===== GENERATE EMBEDDINGS (batch) =====
  if (dedupedClaims.length > 0) {
    logger.info(`Generating embeddings for ${dedupedClaims.length} claims...`);
    const embStart = Date.now();
    try {
      const texts = dedupedClaims.map((c) => c.claimText);
      const vecs = await generateEmbeddings(texts);
      for (let i = 0; i < dedupedClaims.length; i++) {
        dedupedClaims[i].embedding = vecs[i];
      }
      logger.info(
        `Embeddings generated in ${Date.now() - embStart}ms (${vecs[0]?.length}-dim)`,
      );
    } catch (err) {
      logger.error(`Embedding generation failed:`, err);
      // Continue without embeddings; downstream code falls back to text similarity.
    }
  }

  console.log(`Total claims (deduped + embedded): ${dedupedClaims.length}`);

  if (claims.length > 0) {
    console.log("Claim types distribution:");
    const typeDistribution = claims.reduce(
      (acc, claim) => {
        acc[claim.claimType] = (acc[claim.claimType] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const [type, count] of Object.entries(typeDistribution)) {
      console.log(`  ${type}: ${count}`);
    }

    console.log("Actor roles distribution:");
    const roleDistribution = claims.reduce(
      (acc, claim) => {
        acc[claim.actorRole] = (acc[claim.actorRole] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const [role, count] of Object.entries(roleDistribution)) {
      console.log(`  ${role}: ${count}`);
    }
  } else {
    console.log("No claims were extracted");
  }

  return dedupedClaims;
}

async function callGroqApi(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const key = process.env.GROQ_API_KEY ?? apiKey;
  if (!key) {
    throw new Error("Missing GROQ_API_KEY");
  }

  console.log(`CALLING GROQ API`);
  console.log(`Model: ${model}`);
  console.log(`Prompt length: ${prompt.length} characters`);

  try {
    const startTime = Date.now();
    console.log(`Making API request...`);

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a compliance analyst. Respond ONLY with valid JSON. Do not include ANY explanatory text, introductory phrases, or markdown formatting. Start your response directly with { or [.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1, // Slightly higher temperature for more variation
        max_tokens: 4096,
      }),
    });

    const responseTime = Date.now() - startTime;
    console.log(`Response time: ${responseTime}ms`);
    console.log(`Response status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      let errorText = "";
      try {
        errorText = await res.text();
      } catch (e) {
        errorText = "Could not read error response body";
      }

      console.error(`API Error ${res.status}:`, errorText);
      throw new Error(`Groq API error ${res.status}: ${errorText}`);
    }

    let responseText;
    try {
      responseText = await res.text();
      console.log(`Response text length: ${responseText.length} characters`);
    } catch (textError) {
      console.error("Failed to read response as text:", textError);
      throw new Error(`Failed to read response body`);
    }

    let json;
    try {
      json = JSON.parse(responseText);
      console.log("Response JSON parsed successfully");
    } catch (jsonError) {
      console.error("Failed to parse response as JSON:", jsonError);
      throw new Error(`Invalid JSON response from Groq`);
    }

    const content = json?.choices?.[0]?.message?.content;
    console.log("Content found:", !!content);

    if (content) {
      console.log("Content length:", content.length);
      const firstChar = content.trim().charAt(0);
      if (firstChar !== "{" && firstChar !== "[") {
        console.warn(
          `WARNING: Content does not start with JSON! First 50 chars: "${content.substring(0, 50)}..."`,
        );
      }
    } else {
      console.error("No content in response");
      throw new Error(`No content in Groq response`);
    }

    if (typeof content !== "string") {
      throw new Error(`Invalid Groq response structure`);
    }

    console.log(
      `API call successful, returning ${content.length} chars of content`,
    );
    return content;
  } catch (fetchError) {
    console.error("Fetch error details:", fetchError);
    throw fetchError;
  }
}

function buildPrompt(intent: string, blocks: StructureBlock[]): string {
  const formatted = blocks
    .map(
      (b, i) => `
SOURCE_ID: ${b.type}-${b.id ?? i}
TEXT:
"""
${b.text}
"""
`,
    )
    .join("\n");

  // IMPROVED PROMPT - Better at extracting comparative clauses
  const prompt = `
You are extracting legal and policy claims from document sections. Your goal is to identify ALL distinct claims, even when they appear together in comparison.

IMPORTANT: Respond ONLY with valid JSON. Do NOT include any explanatory text, introductory sentences, or markdown formatting. Start your response directly with { or [.

INTENT:
"${intent}"

STRUCTURE BLOCKS:
${formatted}

CRITICAL EXTRACTION RULES:
1. Extract EVERY distinct claim or requirement you find, even if multiple appear in the same block.
2. If text compares two alternatives (e.g., "Company A requires X, while Company B requires Y"), extract BOTH as separate claims.
3. If text lists different options, scenarios, or variations, extract EACH as a separate claim.
4. Look for comparison words: "while", "whereas", "however", "in contrast", "on the other hand", "alternatively", "versus", "compared to".
5. Look for numbered/lettered items: "Option 1:", "Alternative A:", "Scenario 1:", "First:", "Second:".
6. Look for contradictory phrases: "must" vs "must not", "shall" vs "shall not", different timeframes, different amounts.

CLAIM IDENTIFICATION:
- A "claim" is any requirement, obligation, prohibition, permission, definition, or standard.
- Extract claims even if they're presented as examples, alternatives, or hypotheticals.
- If the same requirement appears multiple times, still extract it each time (it will be deduplicated later).

ACTOR/ENTITY EXTRACTION:
- Identify WHO the claim applies to (actorRole): "company", "customer", "vendor", "employee", "both_parties", etc.
- Extract the specific entity name if mentioned (actorRef): e.g., "SalesForce", "Microsoft", "the Company", "Customer".
- If comparing entities, capture each entity separately.

CLAIM TEXT:
- Copy the EXACT wording of each claim.
- Keep it concise but complete.
- Include qualifiers like timeframes, amounts, conditions.
- If a claim has sub-parts, extract the main claim.

EXAMPLES:
Input: "Payment must be made within 30 days for domestic orders, while international orders require 60 days."
Output: TWO claims:
1. claimText: "Payment must be made within 30 days for domestic orders"
2. claimText: "International orders require 60 days"

Input: "Company liability is capped at $100,000 for normal claims, but at $1,000,000 for willful misconduct."
Output: TWO claims:
1. claimText: "Company liability is capped at $100,000 for normal claims"
2. claimText: "Company liability is capped at $1,000,000 for willful misconduct"

Input: "The software warranty is 1 year for basic license and 2 years for premium license."
Output: TWO claims:
1. claimText: "The software warranty is 1 year for basic license"
2. claimText: "The software warranty is 2 years for premium license"

RESPONSE FORMAT (JSON ONLY):
{
  "results": [
    {
      "sourceId": "section-1-A",
      "hasClaim": true,
      "claimType": "obligation",  // "obligation", "prohibition", "permission", "definition", "scope"
      "actorRole": "customer",
      "actorRef": "Customer",
      "claimText": "Exact claim wording from text"
    }
  ]
}

SPECIAL NOTES:
- If a block has NO claims, return hasClaim: false for that result.
- Create a NEW result for EACH distinct claim found.
- Use sourceId to differentiate: "block-0-claim1", "block-0-claim2", etc.
- Do not combine multiple claims into one claimText.
- Do not summarize or paraphrase.
- Do not create claims that aren't explicitly stated.

Start your response directly with { or [. No other text.
`.trim();

  console.log(`PROMPT BUILT: ${prompt.length} chars`);
  console.log(`Blocks in prompt: ${blocks.length}`);

  return prompt;
}
