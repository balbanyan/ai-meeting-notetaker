-- Create meetings table
CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webex_meeting_id VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(500),
    host_email VARCHAR(255),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_webex_id ON meetings(webex_meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_status_start ON meetings(status, start_time);

-- Create attendees table
CREATE TABLE IF NOT EXISTS attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id),
    email VARCHAR(255),
    name VARCHAR(255),
    webex_user_id VARCHAR(255),
    joined_at TIMESTAMP WITH TIME ZONE,
    left_at TIMESTAMP WITH TIME ZONE,
    is_host BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendee_meeting_id ON attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_attendee_email ON attendees(email);
CREATE INDEX IF NOT EXISTS idx_attendee_meeting_email ON attendees(meeting_id, email);

-- Create transcript_segments table
CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id),
    speaker_name VARCHAR(255),
    speaker_email VARCHAR(255),
    text TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    confidence FLOAT,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_meeting_id ON transcript_segments(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcript_meeting_time ON transcript_segments(meeting_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_transcript_speaker ON transcript_segments(speaker_email);

-- Create summaries table
CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id),
    summary_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    generated_by VARCHAR(50) NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summary_meeting_id ON summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_summary_meeting_type ON summaries(meeting_id, summary_type);

-- Create doc_chunks table
CREATE TABLE IF NOT EXISTS doc_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id),
    chunk_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    embedding vector(1536),
    chunk_metadata TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_chunk_meeting_id ON doc_chunks(meeting_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunk_type ON doc_chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_doc_chunk_meeting_time ON doc_chunks(meeting_id, start_ms);

-- Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    webex_meeting_id VARCHAR(255),
    payload TEXT NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_meeting_id ON webhook_events(webex_meeting_id);
CREATE INDEX IF NOT EXISTS idx_webhook_processed ON webhook_events(processed);

-- Create job_runs table
CREATE TABLE IF NOT EXISTS job_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type VARCHAR(50) NOT NULL,
    meeting_id UUID,
    status VARCHAR(50) DEFAULT 'pending',
    input_data TEXT,
    output_data TEXT,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_run_type ON job_runs(job_type);
CREATE INDEX IF NOT EXISTS idx_job_run_status ON job_runs(status);
CREATE INDEX IF NOT EXISTS idx_job_run_meeting ON job_runs(meeting_id);
