const crypto = require('crypto');
const { analyzeAudioChunk } = require('../utils');

const { config } = require('../config');

/**
 * Unified Audio Processor for both GUI and Headless modes
 * Handles real-time audio capture, processing, and WAV chunk creation
 */
class AudioProcessor {
  constructor(meetingId, hostEmail = null, backendClient = null) {
    this.meetingId = meetingId;
    this.hostEmail = hostEmail;
    this.backendClient = backendClient; // Injected dependency
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
   * Initialize chunk count from backend (continue sequence from last chunk)
   */
  async initializeChunkCount() {
    if (this.backendClient && this.meetingId) {
      try {
        const maxChunkId = await this.backendClient.getMeetingChunkCount(this.meetingId);
        this.chunkCount = maxChunkId;
        console.log(`🔄 Initialized chunk count: ${this.chunkCount} (continuing from last chunk)`);
      } catch (error) {
        console.log(`⚠️ Failed to get chunk count, starting from 0:`, error.message);
        this.chunkCount = 0;
      }
    } else {
      console.log(`⚠️ No backend client or meeting ID, starting from 0`);
      this.chunkCount = 0;
    }
  }

  /**
   * Start processing audio stream (for GUI mode with MediaStream)
   */
  async startProcessing(mediaStream) {
    if (this.isProcessing) {
      console.log('⚠️ Audio processing already started');
      return;
    }

    // Initialize chunk count from backend first
    await this.initializeChunkCount();

    try {
      this.isProcessing = true;
      console.log('🎤 Starting audio processing...');

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: config.audio.sampleRate });
      this.source = this.audioContext.createMediaStreamSource(mediaStream);
      
      // Use AnalyserNode for audio capture (modern approach)
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      
      // Connect audio nodes
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      
      // Manual audio capture using setInterval
      let captureCount = 0;
      this.captureInterval = setInterval(() => {
        if (!this.isProcessing) return;
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Float32Array(bufferLength);
        this.analyser.getFloatTimeDomainData(dataArray);
        
        // Debug: Check if we're actually getting audio data
        const hasAudio = dataArray.some(sample => Math.abs(sample) > 0.001);
        captureCount++;
        
        if (captureCount % 30 === 0) { // Log every ~2 seconds
          let maxSample = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const abs = Math.abs(dataArray[i]);
            if (abs > maxSample) maxSample = abs;
          }
          console.log(`🔍 Audio capture ${captureCount}: hasAudio=${hasAudio}, maxSample=${maxSample.toFixed(4)}, bufferSize=${dataArray.length}`);
        }
        
        this.chunkBuffer.push(new Float32Array(dataArray));
        
        // Check if we have 10 seconds of audio
        const elapsedTime = Date.now() - this.chunkStartTime;
        if (elapsedTime >= config.audio.chunkDurationMs) {
          this.processChunk();
        }
      }, 64); // ~15 times per second for smooth capture

      console.log('✅ Audio processing started');

    } catch (error) {
      console.error('❌ Failed to start audio processing:', error);
      this.isProcessing = false;
    }
  }

  /**
   * Start processing for headless mode (documentation-compliant with bridge)
   * Uses the actual meeting audio stream from PuppeteerWebexBridge
   */
  async startHeadlessProcessing(page, bridge) {
    if (this.isProcessing) {
      console.log('⚠️ Audio processing already started');
      return;
    }

    try {
      this.isProcessing = true;
      console.log('🎤 Starting documentation-compliant headless audio processing...');

      // Set up audio capture using the bridge's meeting audio stream
      await page.evaluate((audioConfig) => {
        return new Promise(async (resolve, reject) => {
          try {
            // Wait for meeting audio stream to be available
            let attempts = 0;
            const maxAttempts = 60; // 30 seconds
            
            while (!window.webexAudioStream && attempts < maxAttempts) {
              console.log(`⏳ Waiting for meeting audio stream (attempt ${attempts + 1}/${maxAttempts})...`);
              await new Promise(resolve => setTimeout(resolve, 500));
              attempts++;
            }
            
            if (!window.webexAudioStream) {
              throw new Error('Meeting audio stream not available after timeout');
            }
            
            console.log('✅ Meeting audio stream found, setting up capture...');
            
            // Set up Web Audio API for real-time processing using meeting stream
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: audioConfig.sampleRate
            });
            
            const source = audioContext.createMediaStreamSource(window.webexAudioStream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            
            source.connect(analyser);
            
            // Buffer to accumulate audio chunks
            let audioBuffer = [];
            const targetSamples = audioConfig.sampleRate * (audioConfig.chunkDurationMs / 1000);
            
            console.log(`🎧 Target samples per chunk: ${targetSamples}`);
            
            // Manual audio capture using AnalyserNode (modern approach)
            const captureInterval = setInterval(() => {
              const bufferLength = analyser.frequencyBinCount;
              const dataArray = new Float32Array(bufferLength);
              analyser.getFloatTimeDomainData(dataArray);
              
              // Add samples to buffer
              audioBuffer.push(...dataArray);
              
              // When we have enough samples, send a chunk
              if (audioBuffer.length >= targetSamples) {
                const chunk = audioBuffer.slice(0, targetSamples);
                audioBuffer = audioBuffer.slice(targetSamples);
                
                // Send chunk data to Node.js context for processing
                window.audioChunkReady = chunk;
              }
            }, 100); // Capture every 100ms
            
            // Store references for cleanup
            window.headlessAudioCapture = {
              audioContext,
              source,
              analyser,
              captureInterval
            };
            
            console.log('✅ Documentation-compliant headless audio capture set up successfully');
            resolve();
            
          } catch (error) {
            console.error('❌ Failed to set up documentation-compliant audio capture:', error);
            reject(error);
          }
        });
      }, config.audio);

      // Start chunk processing loop for documentation-compliant mode
      this.startDocumentationCompliantChunkLoop(page);

      console.log('✅ Documentation-compliant headless audio processing started');

    } catch (error) {
      this.isProcessing = false;
      console.error('❌ Failed to start documentation-compliant headless processing:', error);
      throw error;
    }
  }

  /**
   * Start processing for headless mode (using getUserMedia within page context)
   * This method sets up audio capture within a Puppeteer page context
   */
  async startHeadlessProcessing(page) {
    if (this.isProcessing) {
      console.log('⚠️ Audio processing already started');
      return;
    }

    try {
      this.isProcessing = true;
      console.log('🎤 Starting headless audio processing...');

      // Set up audio capture in the browser context
      await page.evaluate((audioConfig) => {
        return new Promise(async (resolve, reject) => {
          try {
            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: audioConfig.sampleRate,
                channelCount: audioConfig.channels
              }
            });
            
            console.log('🎤 Microphone access granted');
            
            // Set up Web Audio API for real-time processing
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({
              sampleRate: audioConfig.sampleRate
            });
            
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            
            // Buffer to accumulate audio chunks
            let audioBuffer = [];
            const targetSamples = audioConfig.sampleRate * (audioConfig.chunkDurationMs / 1000);
            
            // Manual audio capture using setInterval
            const captureInterval = setInterval(() => {
              const bufferLength = analyser.frequencyBinCount;
              const dataArray = new Float32Array(bufferLength);
              analyser.getFloatTimeDomainData(dataArray);
              
              // Convert float32 to int16 and add to buffer
              for (let i = 0; i < dataArray.length; i++) {
                const sample = Math.max(-1, Math.min(1, dataArray[i]));
                audioBuffer.push(Math.floor(sample * 32767));
              }
              
              // When we have enough audio, create a chunk
              if (audioBuffer.length >= targetSamples) {
                const chunkData = audioBuffer.slice(0, targetSamples);
                audioBuffer = audioBuffer.slice(targetSamples);
                
                // Create WAV file from audio data
                const wavBuffer = window.createWAVFile(chunkData, audioConfig.sampleRate, audioConfig.channels);
                
                // Store in global queue for Node.js to pick up
                if (!window.audioChunks) {
                  window.audioChunks = [];
                }
                
                window.audioChunks.push({
                  data: Array.from(new Uint8Array(wavBuffer)), // Convert ArrayBuffer to Array for transfer
                  timestamp: Date.now(),
                  chunkId: `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                });
                
                console.log(`🎵 Audio chunk ready (${wavBuffer.byteLength} bytes)`);
              }
            }, 64); // ~15 times per second
            
            // Helper function to create WAV file (same as AudioProcessor.convertToWAV)
            window.createWAVFile = function(audioData, sampleRate, numChannels = 1) {
              const length = audioData.length;
              const buffer = new ArrayBuffer(44 + length * 2);
              const view = new DataView(buffer);
              
              // WAV header
              const writeString = (offset, string) => {
                for (let i = 0; i < string.length; i++) {
                  view.setUint8(offset + i, string.charCodeAt(i));
                }
              };
              
              const bitsPerSample = 16;
              const byteRate = sampleRate * numChannels * bitsPerSample / 8;
              const blockAlign = numChannels * bitsPerSample / 8;
              const dataSize = length * 2;
              
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
              
              // Audio data
              let offset = 44;
              for (let i = 0; i < length; i++) {
                view.setInt16(offset, audioData[i], true);
                offset += 2;
              }
              
              return buffer;
            };
            
            // Connect audio processing chain
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            
            // Store references for cleanup
            window.captureInterval = captureInterval;
            
            // Store references globally for cleanup
            window.audioContext = audioContext;
            window.audioSource = source;
            window.audioAnalyser = analyser;
            window.audioStream = stream;
            
            console.log('✅ Headless audio processing pipeline established');
            resolve();
            
          } catch (error) {
            console.error('❌ Audio setup failed:', error);
            reject(error);
          }
        });
      }, config.audio);

      // Start the chunk processing loop for headless mode
      this.startHeadlessChunkLoop(page);

      console.log('✅ Headless audio processing started');

    } catch (error) {
      console.error('❌ Failed to start headless audio processing:', error);
      this.isProcessing = false;
    }
  }

  /**
   * Process chunks for headless mode - picks up audio chunks from browser
   */
  startHeadlessChunkLoop(page) {
    const chunkInterval = setInterval(async () => {
      try {
        if (!this.isProcessing) {
          clearInterval(chunkInterval);
          return;
        }
        
        // Check for audio chunks in the browser context
        const audioChunks = await page.evaluate(() => {
          const chunks = window.audioChunks || [];
          window.audioChunks = []; // Clear the queue
          return chunks;
        });
        
        // Process each audio chunk
        for (const chunk of audioChunks) {
          try {
            this.chunkCount++;
            console.log(`🎵 Processing headless audio chunk #${this.chunkCount} (${chunk.data.length} bytes)...`);
            
            // Convert Array back to Node.js Buffer for sending
            const audioBuffer = Buffer.from(chunk.data);
            
            // Send to backend
            if (this.backendClient) {
              await this.backendClient.sendAudioChunk(
                this.meetingId,
                chunk.chunkId,
                audioBuffer,
                this.hostEmail
              );
              
              console.log(`✅ Headless audio chunk #${this.chunkCount} sent to backend successfully`);
            }
            
          } catch (error) {
            console.error(`❌ Error processing headless audio chunk #${this.chunkCount}:`, error);
          }
        }
        
      } catch (error) {
        console.error('❌ Error in headless audio processing loop:', error);
      }
    }, 1000); // Check every second for new chunks
    
    // Store interval reference for cleanup
    this.headlessInterval = chunkInterval;
  }

  /**
   * Process chunks for documentation-compliant headless mode
   * Uses the meeting audio stream directly from bridge
   */
  startDocumentationCompliantChunkLoop(page) {
    const chunkInterval = setInterval(async () => {
      try {
        if (!this.isProcessing) {
          clearInterval(chunkInterval);
          return;
        }
        
        // Check for audio chunks from the documentation-compliant capture
        const audioChunk = await page.evaluate(() => {
          if (window.audioChunkReady) {
            const chunk = Array.from(window.audioChunkReady);
            window.audioChunkReady = null; // Clear after reading
            return chunk;
          }
          return null;
        });
        
        if (audioChunk && audioChunk.length > 0) {
          try {
            this.chunkCount++;
            const chunkId = this.chunkCount;
            
            console.log(`🔄 Processing documentation-compliant audio chunk #${this.chunkCount}`);
            console.log(`📊 Buffer: ${audioChunk.length} samples, Duration: ~${config.audio.chunkDurationMs/1000}s`);
            
            // Analyze audio content (like Electron)
            const nonZeroSamples = audioChunk.filter(sample => Math.abs(sample) > 0.001).length;
            let maxSample = 0;
            for (let i = 0; i < audioChunk.length; i++) {
              const abs = Math.abs(audioChunk[i]);
              if (abs > maxSample) maxSample = abs;
            }
            const nonZeroPercent = (nonZeroSamples / audioChunk.length * 100).toFixed(2);
            
            console.log(`🔍 Audio analysis: ${nonZeroPercent}% non-zero samples, max=${maxSample.toFixed(4)}`);
            
            if (nonZeroPercent < 1) {
              console.log('⚠️ Audio chunk appears to be mostly silence!');
            }
            
            // Convert Float32Array to Buffer for backend
            const bufferArray = new Float32Array(audioChunk);
            const audioData = this.convertToWAV([bufferArray]);
            
            // Send to backend
            if (this.backendClient) {
              await this.backendClient.sendAudioChunk(
                this.meetingId,
                chunkId,
                audioData,
                this.hostEmail
              );
              
              console.log(`✅ Audio chunk sent successfully - Status: saved`);
            }
            
          } catch (error) {
            console.error(`❌ Error processing documentation-compliant audio chunk #${this.chunkCount}:`, error);
          }
        }
        
      } catch (error) {
        console.error('❌ Error in documentation-compliant audio processing loop:', error);
      }
    }, 500); // Check every 500ms for new chunks (more responsive)
    
    // Store interval reference for cleanup
    this.documentationCompliantInterval = chunkInterval;
  }

  /**
   * Process accumulated audio chunk (10 seconds) - for GUI mode
   */
  async processChunk() {
    if (this.chunkBuffer.length === 0) {
      return;
    }

    try {
      this.chunkCount++;
      const chunkId = this.chunkCount;
      
      console.log(`🔄 PROCESSING CHUNK ${this.chunkCount} - ID: ${chunkId}`);
      console.log(`   Buffer Length: ${this.chunkBuffer.length} frames`);
      console.log(`   Duration: ~${config.audio.chunkDurationMs/1000}s`);
      
      // For Electron: also log to UI if addLog function is available
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(`🔄 Processing audio chunk #${this.chunkCount}`, 'info');
        window.addLog(`📊 Buffer: ${this.chunkBuffer.length} frames, Duration: ~${config.audio.chunkDurationMs/1000}s`, 'info');
      }

      // Analyze buffer content before conversion
      let totalSamples = 0;
      let nonZeroSamples = 0;
      let maxSample = 0;
      
      for (const chunk of this.chunkBuffer) {
        for (let i = 0; i < chunk.length; i++) {
          totalSamples++;
          const sample = Math.abs(chunk[i]);
          if (sample > 0.0001) nonZeroSamples++;
          if (sample > maxSample) maxSample = sample;
        }
      }
      
      const nonZeroPercent = totalSamples > 0 ? ((nonZeroSamples / totalSamples) * 100).toFixed(2) : 0;
      console.log(`🔍 AUDIO ANALYSIS: Total=${totalSamples}, NonZero=${nonZeroPercent}%, Max=${maxSample.toFixed(4)}`);
      
      if (typeof window !== 'undefined' && window.addLog) {
        window.addLog(`🔍 Audio analysis: ${nonZeroPercent}% non-zero samples, max=${maxSample.toFixed(4)}`, 'info');
        if (nonZeroPercent < 1) {
          window.addLog('⚠️ Audio chunk appears to be mostly silence!', 'warn');
        }
      }

      // Convert buffer to WAV format
      const audioData = this.convertToWAV(this.chunkBuffer);
      
      // Send to backend
      if (this.backendClient) {
        await this.backendClient.sendAudioChunk(
          this.meetingId,
          chunkId,
          audioData,
          this.hostEmail
        );
      }

      // Reset buffer for next chunk
      this.chunkBuffer = [];
      this.chunkStartTime = Date.now();

    } catch (error) {
      console.error('❌ Failed to process audio chunk:', error);
    }
  }

  /**
   * Convert Float32Array buffer to WAV format
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
      
      // Stop headless interval if running
      if (this.headlessInterval) {
        clearInterval(this.headlessInterval);
        this.headlessInterval = null;
        console.log('✅ Headless audio interval stopped');
      }
      
      // Stop documentation-compliant interval if running
      if (this.documentationCompliantInterval) {
        clearInterval(this.documentationCompliantInterval);
        this.documentationCompliantInterval = null;
        console.log('✅ Documentation-compliant audio interval stopped');
      }
      
      // Stop capture interval and clean up audio nodes (GUI mode)
      if (this.captureInterval) {
        clearInterval(this.captureInterval);
        this.captureInterval = null;
        console.log('✅ Audio capture interval stopped');
      }
      
      if (this.analyser) {
        this.analyser.disconnect();
        this.analyser = null;
        console.log('✅ Audio analyser disconnected');
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
      this.headlessInterval = null;
      this.documentationCompliantInterval = null;
      
      console.log('🧹 Audio processing forcibly cleaned up');
    }
  }

  /**
   * Clean up headless audio resources in browser context
   */
  async stopHeadless(page) {
    if (page) {
      await page.evaluate(() => {
        try {
          // Stop capture interval
          if (window.captureInterval) {
            clearInterval(window.captureInterval);
            window.captureInterval = null;
          }
          
          // Stop documentation-compliant capture
          if (window.headlessAudioCapture) {
            if (window.headlessAudioCapture.captureInterval) {
              clearInterval(window.headlessAudioCapture.captureInterval);
            }
            if (window.headlessAudioCapture.source) {
              window.headlessAudioCapture.source.disconnect();
            }
            if (window.headlessAudioCapture.analyser) {
              window.headlessAudioCapture.analyser.disconnect();
            }
            if (window.headlessAudioCapture.audioContext && window.headlessAudioCapture.audioContext.state !== 'closed') {
              window.headlessAudioCapture.audioContext.close();
            }
            window.headlessAudioCapture = null;
          }
          
          // Stop audio processing
          if (window.audioAnalyser) {
            window.audioAnalyser.disconnect();
            window.audioAnalyser = null;
          }
          
          if (window.audioSource) {
            window.audioSource.disconnect();
            window.audioSource = null;
          }
          
          if (window.audioContext && window.audioContext.state !== 'closed') {
            window.audioContext.close();
            window.audioContext = null;
          }
          
          if (window.audioStream) {
            window.audioStream.getTracks().forEach(track => track.stop());
            window.audioStream = null;
          }
          
          // Clear any remaining audio chunks
          window.audioChunks = [];
          
          console.log('✅ Browser audio resources cleaned up');
        } catch (error) {
          console.error('❌ Error cleaning up audio resources:', error);
        }
      });
    }
    
    // Call regular stop for Node.js side cleanup
    this.stop();
  }
}

module.exports = { AudioProcessor };
