import { createDocument, updateDocument, getDocumentByDocId } from "@/lib/db";

// FIX 1: Add "content" to allowed types
export type DocumentStructureBlock = {
  type: "article" | "clause" | "section" | "policy" | "content" | "heading";
  id?: string;
  title?: string;
  text: string;
  order: number;
};

// Set debug to true by default - always enable debugging
const DEBUG_ENABLED = true;

export async function retrieveAndStoreStructure(params: {
  jobId: string;
  docId: string;
  ocrText: string;
}): Promise<DocumentStructureBlock[]> {
  const { jobId, docId, ocrText } = params;

  console.log(`\n=== DEBUG: Starting structure extraction ===`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Document ID: ${docId}`);
  console.log(`OCR Text length: ${ocrText.length} characters`);
  console.log(`OCR Text preview (first 200 chars):`);
  console.log(ocrText.substring(0, 200));

  const batches = batchText(ocrText, 8000);

  console.log(`\nCreated ${batches.length} batches of max 8000 chars each`);
  console.log(`Batch sizes: ${batches.map((b) => b.length).join(", ")}`);

  let orderCounter = 0;
  const allBlocks: DocumentStructureBlock[] = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`\n--- Processing batch ${i + 1}/${batches.length} ---`);
    console.log(`Batch ${i + 1} length: ${batches[i].length} chars`);
    console.log(`Current order counter: ${orderCounter}`);
    console.log(`Batch preview (first 200 chars):`);
    console.log(batches[i].substring(0, 200));

    const extracted = await extractStructureWithAI({
      docId,
      text: batches[i],
      orderOffset: orderCounter,
    });

    console.log(`Extracted ${extracted.length} blocks from batch ${i + 1}`);
    if (extracted.length > 0) {
      console.log(
        `First extracted block type: ${extracted[0].type}, order: ${extracted[0].order}`,
      );
      console.log(`First extracted block text preview (first 100 chars):`);
      console.log(extracted[0].text.substring(0, 100));
    }

    orderCounter += extracted.length;
    allBlocks.push(...extracted);

    console.log(`\nCumulative blocks: ${allBlocks.length}`);
    console.log(`Block types distribution:`);
    const typeCounts = allBlocks.reduce(
      (acc, block) => {
        acc[block.type] = (acc[block.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    console.log(typeCounts);

    await writeStructureToDB({
      jobId,
      docId,
      structure: allBlocks,
    });

    // Small delay between batches to avoid rate limiting
    if (i < batches.length - 1) {
      const delay = 1000; // 1 second between batches
      console.log(`Waiting ${delay}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.log(`\n=== DEBUG: Structure extraction complete ===`);
  console.log(`Total blocks extracted: ${allBlocks.length}`);
  console.log(`Final order counter: ${orderCounter}`);
  console.log(`Sample blocks (first 3):`);
  allBlocks.slice(0, 3).forEach((block, index) => {
    console.log(`Block ${index + 1}:`);
    console.log(`  Type: ${block.type}`);
    console.log(`  ID: ${block.id || "N/A"}`);
    console.log(`  Title: ${block.title || "N/A"}`);
    console.log(`  Order: ${block.order}`);
    console.log(`  Text preview: ${block.text.substring(0, 150)}...`);
  });

  return allBlocks;
}

async function extractStructureWithAI(params: {
  docId: string;
  text: string;
  orderOffset: number;
}): Promise<DocumentStructureBlock[]> {
  const { text, orderOffset } = params;

  console.log(`\n--- DEBUG: Calling Groq API for structure extraction ---`);
  console.log(`Order offset for this batch: ${orderOffset}`);
  console.log(`Input text length: ${text.length} characters`);
  console.log(`First 300 chars of input text:`);
  console.log(text.substring(0, 300));
  if (text.length > 300) console.log("...");

  const prompt = buildStructurePrompt(text);

  console.log(`Prompt length: ${prompt.length} characters`);
  console.log(`Prompt preview (first 300 chars):`);
  console.log(prompt.substring(0, 300));
  if (prompt.length > 300) console.log("...");

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set in environment variables");
    return [];
  }

  try {
    const startTime = Date.now();

    console.log(`Making API request to Groq...`);
    console.log(`Using model: meta-llama/llama-4-scout-17b-16e-instruct`);

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
          {
            role: "system",
            content:
              "You are a compliance analyst. Respond ONLY with valid JSON. Do not include any explanatory text.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });

    const responseTime = Date.now() - startTime;

    console.log(`API Response time: ${responseTime}ms`);
    console.log(`Response status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      let errorText = "";
      try {
        errorText = await res.text();
        console.error(`API Error ${res.status}:`, errorText);
      } catch (e) {
        errorText = "Could not read error response body";
        console.error(`API Error ${res.status}: Could not read response text`);
      }
      console.error("Groq structure extraction failed", res.status, errorText);
      return [];
    }

    let responseText;
    try {
      responseText = await res.text();
      console.log(`Response text length: ${responseText.length} characters`);
      console.log(`Raw response preview (first 500 chars):`);
      console.log(responseText.substring(0, 500));
      if (responseText.length > 500) console.log("...");
    } catch (textError) {
      console.error("Failed to read response as text:", textError);
      console.error("Failed to read response body from Groq");
      return [];
    }

    let json;
    try {
      json = JSON.parse(responseText);
      console.log("Successfully parsed response JSON");
      console.log("Response JSON keys:", Object.keys(json));
      console.log(`Number of choices: ${json?.choices?.length || 0}`);
    } catch (jsonError) {
      console.error("Failed to parse response as JSON:", jsonError);
      console.error(
        "Problematic response text:",
        responseText.substring(0, 500),
      );
      console.error(
        "Failed to parse AI structure JSON",
        responseText.substring(0, 200),
      );
      return [];
    }

    const raw = json?.choices?.[0]?.message?.content;
    if (!raw) {
      console.error("No content in response");
      console.error("Response structure:", JSON.stringify(json, null, 2));
      console.error("No content in AI response");
      return [];
    }

    console.log(`Raw content length: ${raw.length} characters`);
    console.log(`Raw content preview (first 500 chars):`);
    console.log(raw.substring(0, 500));
    if (raw.length > 500) console.log("...");

    let parsed: any[];
    try {
      // Clean the response if it has markdown code blocks
      const cleanedRaw = raw
        .replace(/```json\n?/g, "")
        .replace(/\n```/g, "")
        .trim();

      if (cleanedRaw !== raw) {
        console.log("Cleaned markdown formatting from response");
      }

      parsed = JSON.parse(cleanedRaw);

      console.log(
        `Successfully parsed structure JSON with ${parsed.length} items`,
      );
      if (parsed.length > 0) {
        console.log("First parsed item:", parsed[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse content as JSON:", parseError);
      console.error("Raw content that failed to parse:", raw.substring(0, 500));
      console.error("Failed to parse AI structure JSON content");
      return [];
    }

    // FIX 2 & 3 & 4: Fix type validation, undefined values, and order numbering
    let validBlockCounter = 0;
    const result = parsed
      .map((block: any) => {
        const type = block.type?.toLowerCase();

        // FIX: Add "content" and "heading" to allowed types
        if (
          ![
            "article",
            "clause",
            "section",
            "policy",
            "content",
            "heading",
          ].includes(type)
        ) {
          if (block.type) {
            console.warn(`Invalid block type "${block.type}", skipping`);
          }
          return null;
        }

        if (!block.text || typeof block.text !== "string") {
          console.warn(`Block has invalid text, skipping`);
          return null;
        }

        // FIX: Create a clean object without undefined values
        const resultBlock: any = {
          type: type as
            | "article"
            | "clause"
            | "section"
            | "policy"
            | "content"
            | "heading",
          text: block.text,
          order: orderOffset + validBlockCounter, // Use validBlockCounter, not idx
        };

        // Only add id if it exists and isn't empty
        if (block.id && block.id.trim() !== "") {
          resultBlock.id = block.id;
        }

        // Only add title if it exists and isn't empty
        if (block.title && block.title.trim() !== "") {
          resultBlock.title = block.title;
        }

        validBlockCounter++;
        return resultBlock;
      })
      .filter(Boolean) as DocumentStructureBlock[];

    console.log(
      `Valid blocks after filtering: ${result.length}/${parsed.length}`,
    );
    if (result.length > 0) {
      console.log("Sample valid block:", {
        type: result[0].type,
        id: result[0].id || "N/A",
        title: result[0].title || "N/A",
        order: result[0].order,
        textLength: result[0].text.length,
      });
    }

    return result;
  } catch (error) {
    console.error("Unexpected error in extractStructureWithAI:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    console.error("Unexpected error during structure extraction:", error);
    return [];
  }
}

function buildStructurePrompt(text: string): string {
  return `
You are given text extracted from a policy document.

Extract structural blocks such as Articles, Clauses, Sections, Policy statements, or Content headings.

Rules:
- Copy text VERBATIM from the input.
- Do not paraphrase, summarize, or merge blocks.
- Each block must correspond to a clear structural unit.
- If no structural unit is found, return an empty array.
- Output MUST be valid JSON only.
- IMPORTANT: Preserve the exact formatting and line breaks from the original text.
- Do not add any explanatory text outside the JSON.

Output format:
[
  {
    "type": "article | clause | section | policy | content | heading",
    "id": "Article 7",
    "title": "Optional title",
    "text": "Verbatim content"
  }
]

Text:
"""
${text}
"""
`.trim();
}

async function writeStructureToDB(params: {
  jobId: string;
  docId: string;
  structure: DocumentStructureBlock[];
}): Promise<void> {
  const { jobId, docId, structure } = params;

  console.log(`\n--- DEBUG: Writing structure to Supabase ---`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Doc ID: ${docId}`);
  console.log(`Structure blocks to write: ${structure.length}`);

  try {
    const cleanedStructure = structure.map((block) => {
      const cleanedBlock: any = {
        type: block.type,
        text: block.text,
        order: block.order,
      };
      if (block.id && block.id.trim() !== "") cleanedBlock.id = block.id;
      if (block.title && block.title.trim() !== "")
        cleanedBlock.title = block.title;
      return cleanedBlock;
    });

    const existing = await getDocumentByDocId(docId);
    if (!existing) {
      const filename = docId.includes("#")
        ? docId.slice(docId.indexOf("#") + 1)
        : docId;
      await createDocument({
        job_id: jobId,
        doc_id: docId,
        filename,
        structure: cleanedStructure,
      });
      console.log(`Created new document record with structure`);
    } else {
      await updateDocument(docId, { structure: cleanedStructure });
      console.log(`Updated existing document record with structure`);
    }
  } catch (error) {
    console.error("Supabase write failed:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    console.error("Failed to write structure to DB:", error);
    throw error;
  }
}

function batchText(text: string, maxChars: number): string[] {
  console.log(
    `\nBatching text: total ${text.length} chars, max ${maxChars} per batch`,
  );

  const batches: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const batch = text.slice(cursor, cursor + maxChars);

    // Try to find a good breaking point (end of paragraph or sentence)
    let adjustedEnd = batch.length;
    if (cursor + batch.length < text.length) {
      // Look for paragraph break first
      const lastParaBreak = batch.lastIndexOf("\n\n");
      if (lastParaBreak > maxChars * 0.7) {
        // Only break if we're past 70% of max
        adjustedEnd = lastParaBreak;
      } else {
        // Look for sentence break
        const lastSentenceBreak = Math.max(
          batch.lastIndexOf(". "),
          batch.lastIndexOf("! "),
          batch.lastIndexOf("? "),
        );
        if (lastSentenceBreak > maxChars * 0.8) {
          // Only break if we're past 80% of max
          adjustedEnd = lastSentenceBreak + 1; // Include the punctuation and space
        }
      }
    }

    const finalBatch = text.slice(cursor, cursor + adjustedEnd);
    batches.push(finalBatch);
    cursor += adjustedEnd || batch.length; // Fallback to prevent infinite loop

    console.log(`Batch ${batches.length}: ${finalBatch.length} chars`);
  }

  return batches;
}
