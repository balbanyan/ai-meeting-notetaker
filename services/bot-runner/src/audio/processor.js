const { config } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('AudioProcessor');

class AudioProcessor {
  constructor(audioWebSocket) {
    this.audioWebSocket = audioWebSocket;
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.isProcessing = false;
    
    // Audio configuration
    this.sampleRate = config.audio.sampleRate;
    this.channels = config.audio.channels;
    this.chunkDurationMs = config.audio.chunkDurationMs;
    this.chunkSamples = (this.sampleRate * this.chunkDurationMs) / 1000;
    
    // Audio buffer for accumulating samples
    this.audioBuffer = [];
  }

  /**
   * Start processing audio from a MediaStream
   */
  async startProcessing(mediaStream) {
    try {
      logger.info('Starting audio processing...');
      
      this.mediaStream = mediaStream;
      
      // Create Web Audio API context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: this.sampleRate
      });
      
      // Create source node from media stream
      this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
      
      // Create script processor node for real-time processing
      const bufferSize = 4096; // Process in 4KB chunks
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 2, 1);
      
      // Set up audio processing callback
      this.processorNode.onaudioprocess = (event) => {
        this.processAudioChunk(event);
      };
      
      // Connect audio graph
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      
      this.isProcessing = true;
      logger.info('Audio processing started successfully');
      
    } catch (error) {
      logger.error('Failed to start audio processing:', error);
      throw error;
    }
  }

  /**
   * Process individual audio chunks from Web Audio API
   */
  processAudioChunk(event) {
    if (!this.isProcessing) return;
    
    try {
      const inputBuffer = event.inputBuffer;
      const outputBuffer = event.outputBuffer;
      
      // Convert stereo to mono by averaging channels
      const leftChannel = inputBuffer.getChannelData(0);
      const rightChannel = inputBuffer.numberOfChannels > 1 ? inputBuffer.getChannelData(1) : leftChannel;
      
      const monoData = new Float32Array(leftChannel.length);
      for (let i = 0; i < leftChannel.length; i++) {
        monoData[i] = (leftChannel[i] + rightChannel[i]) / 2;
      }
      
      // Add to buffer
      this.audioBuffer.push(...monoData);
      
      // Check if we have enough samples for a chunk
      if (this.audioBuffer.length >= this.chunkSamples) {
        this.sendAudioChunk();
      }
      
      // Copy input to output (pass-through)
      for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
        const outputData = outputBuffer.getChannelData(channel);
        outputData.set(leftChannel);
      }
      
    } catch (error) {
      logger.error('Error processing audio chunk:', error);
    }
  }

  /**
   * Send accumulated audio chunk to backend
   */
  sendAudioChunk() {
    try {
      // Extract chunk samples
      const chunkSamples = this.audioBuffer.splice(0, this.chunkSamples);
      
      if (chunkSamples.length < this.chunkSamples) {
        // Pad with zeros if needed
        const padding = new Array(this.chunkSamples - chunkSamples.length).fill(0);
        chunkSamples.push(...padding);
      }
      
      // Convert to 16-bit PCM
      const pcmData = this.floatTo16BitPCM(chunkSamples);
      
      // Create WAV header
      const wavBuffer = this.createWAVBuffer(pcmData);
      
      // Send to backend via WebSocket
      const success = this.audioWebSocket.sendAudioChunk(wavBuffer);
      
      if (success) {
        logger.debug(`Sent audio chunk: ${wavBuffer.byteLength} bytes, ${chunkSamples.length} samples`);
      }
      
    } catch (error) {
      logger.error('Failed to send audio chunk:', error);
    }
  }

  /**
   * Convert Float32Array to 16-bit PCM
   */
  floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return int16Array;
  }

  /**
   * Create WAV file buffer with header
   */
  createWAVBuffer(pcmData) {
    const sampleRate = this.sampleRate;
    const numChannels = this.channels;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = pcmData.length * 2;
    const fileSize = 36 + dataSize;
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, fileSize, true);
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
    
    // PCM data
    const offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      view.setInt16(offset + i * 2, pcmData[i], true);
    }
    
    return buffer;
  }

  /**
   * Stop audio processing
   */
  stopProcessing() {
    try {
      logger.info('Stopping audio processing...');
      
      this.isProcessing = false;
      
      if (this.processorNode) {
        this.processorNode.disconnect();
        this.processorNode = null;
      }
      
      if (this.sourceNode) {
        this.sourceNode.disconnect();
        this.sourceNode = null;
      }
      
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = null;
      }
      
      // Send any remaining audio
      if (this.audioBuffer.length > 0) {
        this.sendAudioChunk();
      }
      
      this.audioBuffer = [];
      
      logger.info('Audio processing stopped');
      
    } catch (error) {
      logger.error('Error stopping audio processing:', error);
    }
  }
}

module.exports = { AudioProcessor };
