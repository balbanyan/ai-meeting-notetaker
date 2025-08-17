-- Initialize database with required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify extensions are installed
SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm');
