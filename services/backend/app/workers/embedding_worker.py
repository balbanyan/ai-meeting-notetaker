from uuid import UUID
from datetime import datetime
from typing import List, Dict, Optional
import json

from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.entities import DocChunk, JobRun


def generate_embeddings_for_text(
    text: str,
    chunk_type: str,
    meeting_id: str,
    metadata: Optional[Dict] = None,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None
) -> dict:
    """
    Generate embeddings for text using OpenAI's embedding model
    
    Args:
        text: Text content to embed
        chunk_type: Type of chunk (transcript, summary)
        meeting_id: UUID of the meeting
        metadata: Optional metadata dict
        start_ms: Start time in milliseconds (for transcript chunks)
        end_ms: End time in milliseconds (for transcript chunks)
    
    Returns:
        dict: Embedding generation results
    """
    db = SessionLocal()
    job_run = None
    
    try:
        # Create job run record
        job_run = JobRun(
            job_type="embedding",
            meeting_id=UUID(meeting_id),
            status="running",
            input_data=f"chunk_type: {chunk_type}, text_length: {len(text)}",
            started_at=datetime.utcnow()
        )
        db.add(job_run)
        db.commit()
        db.refresh(job_run)
        
        # Initialize OpenAI client
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        # Generate embedding using OpenAI
        response = client.embeddings.create(
            model="text-embedding-3-small",  # or text-embedding-3-large for better quality
            input=text,
            encoding_format="float"
        )
        
        embedding_vector = response.data[0].embedding
        
        # Create doc chunk with embedding
        doc_chunk = DocChunk(
            meeting_id=UUID(meeting_id),
            chunk_type=chunk_type,
            content=text,
            start_ms=start_ms,
            end_ms=end_ms,
            embedding=embedding_vector,
            chunk_metadata=json.dumps(metadata) if metadata else None,
            created_at=datetime.utcnow()
        )
        
        db.add(doc_chunk)
        
        # Update job run with success
        job_run.status = "completed"
        job_run.output_data = f"Created embedding for {chunk_type} chunk"
        job_run.completed_at = datetime.utcnow()
        
        db.commit()
        db.refresh(doc_chunk)
        
        return {
            "status": "success",
            "doc_chunk_id": str(doc_chunk.id),
            "embedding_dimension": len(embedding_vector),
            "chunk_type": chunk_type,
            "job_id": str(job_run.id)
        }
    
    except Exception as e:
        # Update job run with error
        if job_run:
            job_run.status = "failed"
            job_run.error_message = str(e)
            job_run.completed_at = datetime.utcnow()
            db.commit()
        
        return {
            "status": "error",
            "error": str(e),
            "job_id": str(job_run.id) if job_run else None
        }
    
    finally:
        db.close()


def generate_embeddings_for_segments(segments: List[Dict]) -> dict:
    """
    Generate embeddings for multiple transcript segments
    
    Args:
        segments: List of segment dicts with id, text, start_ms, end_ms, meeting_id
    
    Returns:
        dict: Batch embedding generation results
    """
    results = []
    errors = []
    
    for segment in segments:
        try:
            result = generate_embeddings_for_text(
                text=segment['text'],
                chunk_type="transcript",
                meeting_id=segment['meeting_id'],
                start_ms=segment['start_ms'],
                end_ms=segment['end_ms'],
                metadata={
                    "segment_id": segment['id'],
                    "duration_ms": segment['end_ms'] - segment['start_ms']
                }
            )
            results.append(result)
        except Exception as e:
            errors.append({
                "segment_id": segment['id'],
                "error": str(e)
            })
    
    return {
        "status": "completed",
        "processed": len(results),
        "errors": len(errors),
        "results": results,
        "error_details": errors
    }


def search_similar_content(
    query: str,
    meeting_id: str,
    limit: int = 5,
    similarity_threshold: float = 0.7
) -> dict:
    """
    Search for similar content using vector similarity
    
    Args:
        query: Search query text
        meeting_id: UUID of the meeting to search within
        limit: Maximum number of results to return
        similarity_threshold: Minimum similarity score (0-1)
    
    Returns:
        dict: Search results with similar content
    """
    db = SessionLocal()
    
    try:
        # Generate embedding for the query
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=query,
            encoding_format="float"
        )
        
        query_embedding = response.data[0].embedding
        
        # Search for similar doc chunks using vector similarity
        # Note: This requires pgvector extension with proper indexing
        similar_chunks = db.execute(f"""
            SELECT 
                id,
                chunk_type,
                content,
                start_ms,
                end_ms,
                chunk_metadata,
                created_at,
                (embedding <=> %s::vector) as distance
            FROM doc_chunks 
            WHERE meeting_id = %s
                AND (embedding <=> %s::vector) < %s
            ORDER BY distance ASC
            LIMIT %s
        """, (
            query_embedding,
            meeting_id,
            query_embedding,
            1.0 - similarity_threshold,  # Convert similarity to distance
            limit
        )).fetchall()
        
        # Format results
        results = []
        for chunk in similar_chunks:
            similarity_score = 1.0 - chunk.distance  # Convert distance back to similarity
            
            metadata = json.loads(chunk.chunk_metadata) if chunk.chunk_metadata else {}
            
            results.append({
                "id": str(chunk.id),
                "chunk_type": chunk.chunk_type,
                "content": chunk.content,
                "start_ms": chunk.start_ms,
                "end_ms": chunk.end_ms,
                "similarity_score": round(similarity_score, 3),
                "metadata": metadata,
                "created_at": chunk.created_at.isoformat()
            })
        
        return {
            "status": "success",
            "query": query,
            "results_count": len(results),
            "results": results
        }
    
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "query": query
        }
    
    finally:
        db.close()


def generate_rag_response(query: str, meeting_id: str) -> dict:
    """
    Generate a response using RAG (Retrieval Augmented Generation)
    
    Args:
        query: User question
        meeting_id: UUID of the meeting
    
    Returns:
        dict: RAG response with answer and sources
    """
    try:
        # Search for relevant content
        search_results = search_similar_content(query, meeting_id, limit=3, similarity_threshold=0.6)
        
        if search_results["status"] != "success" or not search_results["results"]:
            return {
                "status": "no_relevant_content",
                "answer": "I couldn't find relevant information in the meeting transcript to answer your question.",
                "sources": []
            }
        
        # Prepare context from search results
        context_pieces = []
        sources = []
        
        for result in search_results["results"]:
            context_pieces.append(f"[{result['chunk_type']}] {result['content']}")
            sources.append({
                "type": result['chunk_type'],
                "content": result['content'][:200] + "..." if len(result['content']) > 200 else result['content'],
                "start_ms": result['start_ms'],
                "end_ms": result['end_ms'],
                "similarity_score": result['similarity_score']
            })
        
        context = "\n\n".join(context_pieces)
        
        # Generate answer using OpenAI with context
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        response = client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": """You are an AI assistant that answers questions about meeting content. 
Use only the provided context from the meeting transcript and summaries to answer questions. 
If the context doesn't contain enough information to answer the question, say so clearly.
Provide specific, accurate answers based on the meeting content."""
                },
                {
                    "role": "user",
                    "content": f"""Context from meeting:
{context}

Question: {query}

Please answer the question based on the meeting content provided above."""
                }
            ],
            max_tokens=500,
            temperature=0.3
        )
        
        answer = response.choices[0].message.content
        
        return {
            "status": "success",
            "answer": answer,
            "sources": sources,
            "query": query
        }
    
    except Exception as e:
        return {
            "status": "error",
            "error": str(e),
            "query": query
        }
