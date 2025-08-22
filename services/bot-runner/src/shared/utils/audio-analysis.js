/**
 * Audio Analysis Utilities
 * Common functions for analyzing audio chunks and buffers
 */

/**
 * Analyze audio chunk for content and quality
 * @param {Array|Float32Array} audioChunk - Audio samples to analyze
 * @returns {Object} Analysis results with non-zero samples, max sample, and percentage
 */
function analyzeAudioChunk(audioChunk) {
  const nonZeroSamples = audioChunk.filter(sample => Math.abs(sample) > 0.001).length;
  
  let maxSample = 0;
  for (let i = 0; i < audioChunk.length; i++) {
    const abs = Math.abs(audioChunk[i]);
    if (abs > maxSample) maxSample = abs;
  }
  
  const nonZeroPercent = (nonZeroSamples / audioChunk.length * 100).toFixed(2);
  
  return {
    nonZeroSamples,
    maxSample,
    nonZeroPercent,
    totalSamples: audioChunk.length,
    isSilence: nonZeroPercent < 1
  };
}

/**
 * Test audio stream for activity
 * @param {MediaStream} stream - Audio stream to test
 * @param {number} testDurationMs - How long to test (default: 1000ms)
 * @returns {Promise<Object>} Test results with activity status and max sample
 */
async function testAudioStreamActivity(stream, testDurationMs = 1000) {
  return new Promise((resolve) => {
    const testContext = new AudioContext();
    const testAnalyser = testContext.createAnalyser();
    const testSource = testContext.createMediaStreamSource(stream);
    
    testSource.connect(testAnalyser);
    
    const testBuffer = new Float32Array(testAnalyser.frequencyBinCount);
    
    setTimeout(() => {
      testAnalyser.getFloatTimeDomainData(testBuffer);
      const hasActivity = testBuffer.some(sample => Math.abs(sample) > 0.001);
      
      let maxSample = 0;
      for (let i = 0; i < testBuffer.length; i++) {
        const abs = Math.abs(testBuffer[i]);
        if (abs > maxSample) maxSample = abs;
      }
      
      testSource.disconnect();
      testContext.close();
      
      resolve({
        hasActivity,
        maxSample,
        bufferSize: testBuffer.length
      });
    }, testDurationMs);
  });
}

/**
 * Calculate target samples for a given duration and sample rate
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} sampleRate - Sample rate in Hz
 * @returns {number} Number of target samples
 */
function calculateTargetSamples(durationMs, sampleRate) {
  return sampleRate * (durationMs / 1000);
}

module.exports = {
  analyzeAudioChunk,
  testAudioStreamActivity,
  calculateTargetSamples
};
