"""
Test script to verify Groq word-level timestamps work and compare performance
Run this before implementing the new audio_speaker_mapper

Usage:
    python test_groq_word_timestamps.py <path_to_audio_file>
    
Example:
    python test_groq_word_timestamps.py /Users/badralbanyan/Developer/speaker-diarization/inputs/harvard.wav
"""

import asyncio
import httpx
import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from backend .env file
env_path = Path(__file__).parent / "services/backend/.env"
if env_path.exists():
    load_dotenv(env_path)
    print(f"📄 Loaded environment from: {env_path}")
else:
    print(f"⚠️  No .env file found at: {env_path}")
    print("   Trying default environment variables...")

async def test_groq_word_timestamps(audio_path: str = None):
    """Test if Groq word-level timestamps are working and compare performance"""
    
    # Get API key from environment
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        print("❌ GROQ_API_KEY not set in environment")
        print("Please set it with: export GROQ_API_KEY='your-key-here'")
        return
    
    print("🧪 Testing Groq: Word-Level vs Normal Transcription")
    print("=" * 60)
    
    # Use provided path or default
    if audio_path:
        test_audio_path = Path(audio_path)
    else:
        test_audio_path = Path(__file__).parent / "test_audio.wav"
    
    if not test_audio_path.exists():
        print(f"❌ Audio file not found at: {test_audio_path}")
        print("\nUsage: python test_groq_word_timestamps.py <path_to_audio_file>")
        print("\nExample:")
        print("  python test_groq_word_timestamps.py /Users/badralbanyan/Developer/speaker-diarization/inputs/harvard.wav")
        return
    
    try:
        with open(test_audio_path, 'rb') as audio_file:
            audio_data = audio_file.read()
        
        print(f"✅ Loaded test audio: {test_audio_path.name}")
        print(f"   Size: {len(audio_data):,} bytes ({len(audio_data)/1024/1024:.2f} MB)")
        print()
        
        # Test 1: Normal transcription (no word timestamps)
        print("📝 Test 1: Normal transcription (no word timestamps)...")
        import time
        start_time = time.time()
        result_normal = await make_groq_request(api_key, audio_data, test_audio_path.suffix, include_words=False)
        normal_time = time.time() - start_time
        
        if result_normal:
            print(f"   ✅ Completed in {normal_time:.2f}s")
            print(f"   📝 Transcript length: {len(result_normal.get('text', ''))} chars")
        else:
            print("   ❌ Failed!")
            return False
        
        print()
        
        # Test 2: Word-level timestamps
        print("📝 Test 2: Word-level timestamps...")
        start_time = time.time()
        result_words = await make_groq_request(api_key, audio_data, test_audio_path.suffix, include_words=True)
        words_time = time.time() - start_time
        
        if result_words:
            print(f"   ✅ Completed in {words_time:.2f}s")
            print(f"   📝 Transcript length: {len(result_words.get('text', ''))} chars")
            if 'words' in result_words:
                print(f"   🎯 Word timestamps: {len(result_words.get('words', []))} words")
        else:
            print("   ❌ Failed!")
            return False
        
        print()
        print("=" * 60)
        print("⏱️  PERFORMANCE COMPARISON")
        print("=" * 60)
        print(f"Normal transcription:     {normal_time:.3f}s")
        print(f"Word-level timestamps:    {words_time:.3f}s")
        print(f"Difference:               {words_time - normal_time:.3f}s ({((words_time - normal_time) / normal_time * 100):.1f}%)")
        
        if words_time > normal_time:
            overhead_pct = ((words_time - normal_time) / normal_time) * 100
            print(f"\n💡 Word timestamps add ~{overhead_pct:.1f}% overhead")
        else:
            print(f"\n💡 Word timestamps are actually faster (or within margin of error)")
        
        print()
        print("=" * 60)
        print("📊 WORD TIMESTAMP SAMPLE")
        print("=" * 60)
        if 'words' in result_words and result_words['words']:
            print("First 5 words with timestamps:")
            for word_data in result_words['words'][:5]:
                print(f"  '{word_data.get('word')}' @ {word_data.get('start'):.2f}s - {word_data.get('end'):.2f}s")
        
        return True
            
    except Exception as e:
        print(f"\n❌ Error during test: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


async def make_groq_request(api_key: str, audio_data: bytes, file_ext: str, include_words: bool = True):
    """Make request to Groq with word-level timestamps"""
    
    # Determine MIME type based on file extension
    mime_types = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mp3',
        '.m4a': 'audio/m4a',
        '.ogg': 'audio/ogg',
        '.webm': 'audio/webm'
    }
    mime_type = mime_types.get(file_ext.lower(), 'audio/wav')
    filename = f'audio{file_ext}'
    
    # Prepare request according to Groq docs
    files = {
        'file': (filename, audio_data, mime_type),
        'model': (None, 'whisper-large-v3-turbo'),
        'response_format': (None, 'verbose_json'),  # Required for timestamps
        'temperature': (None, '0')
    }
    
    # Add timestamp granularities for word-level timestamps
    if include_words:
        files['timestamp_granularities[]'] = (None, 'word')
    
    headers = {
        'Authorization': f'Bearer {api_key}'
    }
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                files=files,
                headers=headers
            )
        
        if response.status_code == 200:
            return response.json()
        else:
            print(f"❌ API Error {response.status_code}: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Request failed: {str(e)}")
        raise


def print_request_format():
    """Print the expected request format"""
    print("\nExpected Groq API Request Format:")
    print("-" * 60)
    print("""
POST https://api.groq.com/openai/v1/audio/transcriptions

Headers:
  Authorization: Bearer {GROQ_API_KEY}

Form Data:
  file: audio.wav (binary)
  model: whisper-large-v3-turbo
  response_format: verbose_json  ← REQUIRED for timestamps
  timestamp_granularities[]: word  ← REQUIRED for word timestamps
  temperature: 0

Expected Response (if working):
{
  "text": "full transcript here",
  "language": "en",
  "duration": 10.5,
  "words": [
    {
      "word": "Hello",
      "start": 0.0,
      "end": 0.5
    },
    {
      "word": "world",
      "start": 0.6,
      "end": 1.2
    }
    ...
  ],
  "segments": [
    {
      "id": 0,
      "start": 0.0,
      "end": 5.0,
      "text": "Hello world this is a test.",
      "tokens": [...],
      "avg_logprob": -0.1,
      "compression_ratio": 1.5,
      "no_speech_prob": 0.01
    }
  ]
}
""")


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("GROQ PERFORMANCE TEST: WORD TIMESTAMPS vs NORMAL")
    print("=" * 60 + "\n")
    
    # Get audio file path from command line argument
    audio_path = sys.argv[1] if len(sys.argv) > 1 else None
    
    result = asyncio.run(test_groq_word_timestamps(audio_path))
    
    print("\n" + "=" * 60)
    if result:
        print("✅ TEST COMPLETE - Performance comparison successful!")
    else:
        print("⚠️  TEST FAILED or INCOMPLETE")
    print("=" * 60 + "\n")

