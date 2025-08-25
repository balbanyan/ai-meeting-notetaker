-- Migration to add updated_at column and change chunk_id to integer
-- Run this SQL if you have an existing database

-- Add updated_at column
ALTER TABLE audio_chunks 
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Update the updated_at column to match created_at for existing records
UPDATE audio_chunks 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- Change chunk_id from string to integer (only if you have no data, otherwise backup first!)
-- WARNING: This will lose data if chunk_id contains non-numeric values
-- ALTER TABLE audio_chunks ALTER COLUMN chunk_id TYPE INTEGER USING chunk_id::INTEGER;

-- For new installations, drop and recreate the table:
-- DROP TABLE IF EXISTS audio_chunks;
-- (Then restart the backend to recreate with new schema)
