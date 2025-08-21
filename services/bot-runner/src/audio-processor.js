const crypto = require('crypto');

// Simple UUID v4 generator
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
const { config } = require('./config');
const { BackendClient } = require('./http-client');

class AudioProcessor {
  constructor(meetingId, hostEmail = null) {
    this.meetingId = meetingId;
    this.hostEmail = hostEmail;
    this.backendClient = new BackendClient();
    this.chunkBuffer = [];
    this.chunkStartTime = Date.now();
    this.isProcessing = false;
    this.chunkCount = 0;
    
    // Audio processing nodes (for cleanup)
    this.audioContext = null;
    this.source = null;
    this.processor = null;
  }

  /**
   * Start processing audio stream
   */
  async startProcessing(mediaStream) {
    if (this.isProcessing) {
      console.log('⚠️ Audio processing already started');
      return;
    }

    try {
      this.isProcessing = true;
      console.log('🎤 Starting audio processing...');

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: config.audio.sampleRate });
      this.source = this.audioContext.createMediaStreamSource(mediaStream);
      
      // Create script processor for 10-second chunks
      const bufferSize = 4096; // Processing buffer size
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.processor.onaudioprocess = (event) => {
        if (!this.isProcessing) return; // Stop processing if stopped
        
        const inputData = event.inputBuffer.getChannelData(0);
        this.chunkBuffer.push(new Float32Array(inputData));
        
        // Check if we have 10 seconds of audio
        const elapsedTime = Date.now() - this.chunkStartTime;
        if (elapsedTime >= config.audio.chunkDurationMs) {
          this.processChunk();
        }
      };

      // Connect audio nodes
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('✅ Audio processing started');

    } catch (error) {
      console.error('❌ Failed to start audio processing:', error);
      this.isProcessing = false;
    }
  }

  /**
   * Process accumulated audio chunk (10 seconds)
   */
  async processChunk() {
    if (this.chunkBuffer.length === 0) {
      return;
    }

    try {
      this.chunkCount++;
      const chunkId = uuidv4();
      
      console.log(`🔄 PROCESSING CHUNK ${this.chunkCount} - ID: ${chunkId}`);
      console.log(`   Buffer Length: ${this.chunkBuffer.length} frames`);
      console.log(`   Duration: ~${config.audio.chunkDurationMs/1000}s`);

      // Convert buffer to WAV format (simplified)
      const audioData = this.convertToWAV(this.chunkBuffer);
      
      // Send to backend
      await this.backendClient.sendAudioChunk(
        this.meetingId,
        chunkId,
        audioData,
        this.hostEmail
      );

      // Reset buffer for next chunk
      this.chunkBuffer = [];
      this.chunkStartTime = Date.now();

    } catch (error) {
      console.error('❌ Failed to process audio chunk:', error);
    }
  }

  /**
   * Convert Float32Array buffer to WAV format (simplified)
   */
  convertToWAV(bufferArray) {
    // Flatten all chunks into single array
    const totalLength = bufferArray.reduce((sum, chunk) => sum + chunk.length, 0);
    const combinedBuffer = new Float32Array(totalLength);
    
    let offset = 0;
    for (const chunk of bufferArray) {
      combinedBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to 16-bit PCM
    const pcmBuffer = new Int16Array(combinedBuffer.length);
    for (let i = 0; i < combinedBuffer.length; i++) {
      pcmBuffer[i] = Math.max(-1, Math.min(1, combinedBuffer[i])) * 0x7FFF;
    }

    // Create WAV header
    const sampleRate = config.audio.sampleRate;
    const numChannels = config.audio.channels;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmBuffer.length * 2;

    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);

    // Write PCM data
    const samples = new Int16Array(buffer, 44);
    samples.set(pcmBuffer);

    return Buffer.from(buffer);
  }

  /**
   * Stop processing and clean up audio nodes
   */
  stop() {
    console.log('🛑 Stopping audio processing...');
    
    try {
      // Stop processing flag
      this.isProcessing = false;
      
      // Disconnect and clean up audio nodes
      if (this.processor) {
        this.processor.disconnect();
        this.processor.onaudioprocess = null;
        this.processor = null;
        console.log('✅ Audio processor disconnected');
      }
      
      if (this.source) {
        this.source.disconnect();
        this.source = null;
        console.log('✅ Audio source disconnected');
      }
      
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
        this.audioContext = null;
        console.log('✅ Audio context closed');
      }
      
      // Clear any remaining buffer
      this.chunkBuffer = [];
      
      console.log('🎵 Audio processing fully stopped and cleaned up');
      
    } catch (error) {
      console.error('❌ Error during audio cleanup:', error);
      
      // Force clear everything even if cleanup failed
      this.isProcessing = false;
      this.processor = null;
      this.source = null;
      this.audioContext = null;
      this.chunkBuffer = [];
      
      console.log('🧹 Audio processing forcibly cleaned up');
    }
  }
}

module.exports = { AudioProcessor };
