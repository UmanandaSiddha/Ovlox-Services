-- Enable pgvector extension for vector similarity search
-- 
-- IMPORTANT: pgvector must be installed on your PostgreSQL server BEFORE running this migration.
-- If you get "extension vector is not available" error:
--   1. See QUICK_FIX.md in this directory for installation instructions
--   2. Or use Docker container: docker-compose up -d db (has pgvector pre-installed)
--   3. Or manually install pgvector, then run: CREATE EXTENSION vector; in your database
--
-- This will fail if pgvector is not installed. Install pgvector first!
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector column to Embedding table
-- Dimension: 1536 for text-embedding-3-small model (OpenAI's embedding model)
-- This will fail if pgvector extension is not installed - install pgvector first!
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'Embedding' AND column_name = 'vector'
    ) THEN
        ALTER TABLE "Embedding" ADD COLUMN vector vector(1536);
    END IF;
END $$;

-- Create HNSW index for efficient vector similarity search
-- HNSW (Hierarchical Navigable Small World) is the recommended index type for pgvector
-- This enables fast approximate nearest neighbor search using cosine distance (<=> operator)
CREATE INDEX IF NOT EXISTS embedding_vector_hnsw_idx 
ON "Embedding" 
USING hnsw (vector vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Note: The vector column stores actual embedding vectors for similarity search
-- The vectorRef column in the Embedding table remains for external reference/lookup
-- Both can coexist - vectorRef for IDs, vector column for actual vector data

-- IMPORTANT: If this migration fails with "extension vector is not available":
-- 1. Install pgvector on your PostgreSQL server first (see README.md in this directory)
-- 2. Or use the Docker container: docker-compose up -d db
-- 3. Then run this migration again
