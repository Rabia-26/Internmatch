import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* ---------------- Types ---------------- */

export interface Job {
  id: string;
  status: string;
  stage: string;
  progress: { processedFiles: number; totalFiles: number } | null;
  result: any;
  error: string | null;
  file_count: number;
  linked: boolean;
  document_type: string | null;
  effective_date: string | null;
  user_id: string | null;
  files: any;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
}

export interface Claim {
  id: string;
  job_id: string;
  doc_id: string;
  claim_text: string;
  claim_type: string;
  actor_role: string | null;
  actor_ref: string | null;
  intent: string | null;
  embedding: number[] | null;
  model: string | null;
  provider: string | null;
  source_id: string | null;
  created_at: string;
}

export interface Difference {
  id: string;
  job_id: string;
  doc_id: string;
  type: string;
  claim_a_id: string;
  claim_b_id: string;
  claim_a_text: string;
  claim_b_text: string;
  claim_a_type: string;
  claim_b_type: string;
  doc_a_id: string;
  doc_b_id: string;
  similarity_score: number;
  explanation: string;
  contradiction: boolean;
  created_at: string;
}

/* ---------------- Job helpers ---------------- */

export async function getJob(
  id: string,
): Promise<ReturnType<typeof mapJob> | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return mapJob(data);
}

export async function getJobForUser(
  id: string,
  userId: string,
): Promise<ReturnType<typeof mapJob> | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return mapJob(data);
}

export async function createJob(
  id: string,
  overrides: Partial<Job> = {},
): Promise<Job | null> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      id,
      status: overrides.status ?? "processing",
      stage: overrides.stage ?? "queued",
      progress: overrides.progress ?? { processedFiles: 0, totalFiles: 0 },
      file_count: overrides.file_count ?? 0,
      linked: overrides.linked ?? false,
      document_type: overrides.document_type ?? null,
      effective_date: overrides.effective_date ?? null,
      user_id: overrides.user_id ?? null,
      result: null,
      error: null,
    })
    .select()
    .single();
  if (error) {
    console.error("[DB] createJob error:", error);
    return null;
  }
  return data as unknown as Job;
}

export async function listJobs(
  limit = 50,
): Promise<ReturnType<typeof mapJob>[]> {
  // Avoid pulling the huge base64 `files` column. We only need metadata + result summary.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,status,stage,progress,result,error,file_count,linked,document_type,effective_date,created_at,updated_at,completed_at,failed_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapJob);
}

export async function listJobsForUser(
  userId: string,
  limit = 50,
): Promise<ReturnType<typeof mapJob>[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id,status,stage,progress,result,error,file_count,linked,document_type,effective_date,user_id,created_at,updated_at,completed_at,failed_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapJob);
}

export async function updateJob(
  id: string,
  updates: Partial<Job>,
): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error("[DB] updateJob error:", error);
    throw new Error(`[DB] Failed to update job ${id}: ${error.message}`);
  }
}

/* ---------------- Document helpers ---------------- */

export async function getDocumentByJobId(jobId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getDocumentByDocId(docId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("doc_id", docId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function createDocument(doc: {
  job_id: string;
  doc_id: string;
  filename: string;
  ocr_text?: string | null;
  structure?: any;
}): Promise<any | null> {
  const { data, error } = await supabase
    .from("documents")
    .insert(doc)
    .select()
    .single();
  if (error) {
    console.error("[DB] createDocument error:", error);
    return null;
  }
  return data;
}

export async function updateDocument(
  docId: string,
  updates: { ocr_text?: string; structure?: any },
): Promise<void> {
  const { error } = await supabase
    .from("documents")
    .update(updates)
    .eq("doc_id", docId);
  if (error) {
    console.error("[DB] updateDocument error:", error);
  }
}

/* ---------------- Claim helpers ---------------- */

export async function createClaims(claims: Claim[]): Promise<void> {
  if (claims.length === 0) return;
  const { error } = await supabase.from("claims").insert(
    claims.map((c) => ({
      id: c.id,
      job_id: c.job_id,
      doc_id: c.doc_id,
      claim_text: c.claim_text,
      claim_type: c.claim_type,
      actor_role: c.actor_role,
      actor_ref: c.actor_ref,
      intent: c.intent,
      embedding: c.embedding,
      model: c.model,
      provider: c.provider,
      source_id: c.source_id,
      created_at: c.created_at ?? new Date().toISOString(),
    })),
  );
  if (error) {
    console.error("[DB] createClaims error:", error);
  }
}

export async function getClaimsByDocId(
  docId: string,
): Promise<ReturnType<typeof mapClaim>[]> {
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .eq("doc_id", docId);
  if (error || !data) return [];
  return data.map(mapClaim);
}

export async function getClaimsByJobId(
  jobId: string,
): Promise<ReturnType<typeof mapClaim>[]> {
  const { data, error } = await supabase
    .from("claims")
    .select("*")
    .eq("job_id", jobId);
  if (error || !data) return [];
  return data.map(mapClaim);
}

/* ---------------- Mapping helpers ---------------- */

export function mapClaim(row: any): {
  claimId: string;
  docId: string;
  jobId: string;
  claimText: string;
  claimType: string;
  actorRole?: string;
  actorRef?: string;
  intent?: string;
  embedding?: number[];
  model?: string;
  provider?: string;
  sourceId?: string;
  createdAt?: number;
} {
  return {
    claimId: row.id,
    docId: row.doc_id,
    jobId: row.job_id,
    claimText: row.claim_text,
    claimType: row.claim_type,
    actorRole: row.actor_role ?? undefined,
    actorRef: row.actor_ref ?? undefined,
    intent: row.intent ?? undefined,
    embedding: row.embedding ?? undefined,
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    sourceId: row.source_id ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
  };
}

export function mapDifference(row: any): {
  differenceId: string;
  docId: string;
  jobId: string;
  type: string;
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
  contradiction: boolean;
  detectedAt: number;
  createdAt: number;
} {
  return {
    differenceId: row.id,
    docId: row.doc_id,
    jobId: row.job_id,
    type: row.type,
    claimAId: row.claim_a_id,
    claimBId: row.claim_b_id,
    claimAText: row.claim_a_text,
    claimBText: row.claim_b_text,
    claimAType: row.claim_a_type,
    claimBType: row.claim_b_type,
    docAId: row.doc_a_id,
    docBId: row.doc_b_id,
    similarityScore: row.similarity_score ?? 0,
    explanation: row.explanation,
    contradiction: row.contradiction,
    detectedAt: row.created_at
      ? new Date(row.created_at).getTime()
      : Date.now(),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

export function mapJob(row: any): {
  jobId: string;
  status: string;
  stage: string;
  progress: any;
  result: any;
  error: any;
  fileCount: number;
  linked: boolean;
  documentType: string | null;
  effectiveDate: string | null;
  userId: string | null;
  files: any;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  failedAt: number | null;
} {
  return {
    jobId: row.id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    result: row.result,
    error: row.error,
    fileCount: row.file_count,
    linked: row.linked,
    documentType: row.document_type,
    effectiveDate: row.effective_date,
    userId: row.user_id ?? null,
    files: row.files,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    failedAt: row.failed_at ? new Date(row.failed_at).getTime() : null,
  };
}

export async function consumeAiMessageQuota(
  userId: string,
  limit: number,
  amount = 1,
): Promise<{ allowed: boolean; used: number; remaining: number }> {
  const { data, error } = await supabase.rpc("consume_ai_message_quota", {
    p_user_id: userId,
    p_limit: limit,
    p_amount: amount,
  });

  if (error || !data || !Array.isArray(data) || data.length === 0) {
    throw new Error(error?.message ?? "Failed to consume AI message quota");
  }

  const row = data[0] as {
    allowed: boolean;
    used: number;
    remaining: number;
  };

  return row;
}

/* ---------------- Difference helpers ---------------- */

export async function createDifferences(
  differences: Difference[],
): Promise<void> {
  if (differences.length === 0) return;
  const { error } = await supabase.from("differences").insert(
    differences.map((d) => ({
      id: d.id,
      job_id: d.job_id,
      doc_id: d.doc_id,
      type: d.type,
      claim_a_id: d.claim_a_id,
      claim_b_id: d.claim_b_id,
      claim_a_text: d.claim_a_text,
      claim_b_text: d.claim_b_text,
      claim_a_type: d.claim_a_type,
      claim_b_type: d.claim_b_type,
      doc_a_id: d.doc_a_id,
      doc_b_id: d.doc_b_id,
      similarity_score: d.similarity_score,
      explanation: d.explanation,
      contradiction: d.contradiction,
      created_at: d.created_at ?? new Date().toISOString(),
    })),
  );
  if (error) {
    console.error("[DB] createDifferences error:", error);
  }
}

export async function getDifferencesByJobId(
  jobId: string,
): Promise<ReturnType<typeof mapDifference>[]> {
  const { data, error } = await supabase
    .from("differences")
    .select("*")
    .eq("job_id", jobId);
  if (error || !data) return [];
  return data.map(mapDifference);
}

export async function getDifferencesByDocId(
  docId: string,
): Promise<ReturnType<typeof mapDifference>[]> {
  const { data, error } = await supabase
    .from("differences")
    .select("*")
    .eq("doc_id", docId);
  if (error || !data) return [];
  return data.map(mapDifference);
}

/* ---------------- Vector search (RAG) ---------------- */

export async function searchClaimsByEmbedding(
  jobId: string,
  embedding: number[],
  limit = 10,
): Promise<ReturnType<typeof mapClaim>[]> {
  // pgvector expects array literals as text strings, e.g. "[0.1,0.2,...]"
  const pgVector = `[${embedding.join(",")}]`;
  const { data, error } = await supabase.rpc("search_claims", {
    p_job_id: jobId,
    p_embedding: pgVector,
    p_limit: limit,
  });
  if (error || !data) {
    console.error("[DB] searchClaimsByEmbedding error:", error);
    return [];
  }
  return (data as any[]).map(mapClaim);
}
