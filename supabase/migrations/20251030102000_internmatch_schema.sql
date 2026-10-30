-- InternMatch / WatchDoc schema (run once on empty Supabase project)
-- Enable pgvector in Dashboard > Database > Extensions if this line fails.
CREATE EXTENSION IF NOT EXISTS vector;

-- Jobs table (replaces DocumentResults)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'processing',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress JSONB DEFAULT '{"processedFiles": 0, "totalFiles": 0}'::jsonb,
  result JSONB DEFAULT NULL,
  error TEXT DEFAULT NULL,
  file_count INT DEFAULT 0,
  linked BOOLEAN DEFAULT FALSE,
  document_type TEXT DEFAULT NULL,
  effective_date TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ DEFAULT NULL,
  failed_at TIMESTAMPTZ DEFAULT NULL
);

-- Documents table (one row per uploaded file)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  ocr_text TEXT DEFAULT NULL,
  structure JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_job_id ON documents(job_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_id ON documents(doc_id);

-- Claims table (with pgvector embeddings)
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'unknown',
  actor_role TEXT DEFAULT NULL,
  actor_ref TEXT DEFAULT NULL,
  intent TEXT DEFAULT NULL,
  embedding vector(384) DEFAULT NULL,
  model TEXT DEFAULT NULL,
  provider TEXT DEFAULT NULL,
  source_id TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claims_doc_id ON claims(doc_id);
CREATE INDEX IF NOT EXISTS idx_claims_job_id ON claims(job_id);

-- Differences table (contradictions, changes, etc.)
CREATE TABLE IF NOT EXISTS differences (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  type TEXT NOT NULL,
  claim_a_id TEXT NOT NULL,
  claim_b_id TEXT NOT NULL,
  claim_a_text TEXT NOT NULL,
  claim_b_text TEXT NOT NULL,
  claim_a_type TEXT NOT NULL DEFAULT 'unknown',
  claim_b_type TEXT NOT NULL DEFAULT 'unknown',
  doc_a_id TEXT NOT NULL,
  doc_b_id TEXT NOT NULL,
  similarity_score INT DEFAULT 0,
  explanation TEXT NOT NULL DEFAULT '',
  contradiction BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_differences_job_id ON differences(job_id);
CREATE INDEX IF NOT EXISTS idx_differences_doc_id ON differences(doc_id);

-- Chat sessions (for future chatbot)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_job_id ON chat_sessions(job_id);

CREATE TABLE IF NOT EXISTS user_usage (
  user_id TEXT PRIMARY KEY,
  ai_messages_used INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS files JSONB DEFAULT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);

CREATE INDEX IF NOT EXISTS idx_claims_embedding ON claims USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION search_claims(
  p_job_id TEXT,
  p_embedding TEXT,
  p_limit INT DEFAULT 10
)
RETURNS SETOF claims
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM claims
  WHERE job_id = p_job_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_embedding::vector(384)
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION consume_ai_message_quota(
  p_user_id TEXT,
  p_limit INT DEFAULT 15,
  p_amount INT DEFAULT 1
)
RETURNS TABLE(allowed BOOLEAN, used INT, remaining INT)
LANGUAGE plpgsql
AS $$
DECLARE
  current_used INT;
BEGIN
  INSERT INTO user_usage (user_id, ai_messages_used, created_at, updated_at)
  VALUES (p_user_id, 0, NOW(), NOW())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT ai_messages_used
  INTO current_used
  FROM user_usage
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_used + p_amount > p_limit THEN
    RETURN QUERY SELECT FALSE, current_used, GREATEST(p_limit - current_used, 0);
    RETURN;
  END IF;

  UPDATE user_usage
  SET ai_messages_used = current_used + p_amount,
      updated_at = NOW()
  WHERE user_id = p_user_id;

  RETURN QUERY
  SELECT TRUE, current_used + p_amount, GREATEST(p_limit - (current_used + p_amount), 0);
END;
$$;
