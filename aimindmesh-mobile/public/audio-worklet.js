/**
 * AudioWorklet Processor for high-quality audio recording
 * Optimized for Whisper transcription (16kHz, PCM16)
 * 
 * This runs in a dedicated audio thread for low-latency processing.
 * 
 * Supports long recordings by streaming chunks to main thread periodically.
 */



class AudioRecorderWorklet extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        this.isRecording = false;
        // Use typed arrays for better performance and memory efficiency
        this.audioChunks = [];  // Array of Int16Arrays
        this.sampleCount = 0;
        this.totalSamplesRecorded = 0;
        this.chunkSampleCount = 0;  // Counter for chunk streaming

        // Handle messages from main thread
        this.port.onmessage = (event) => {
            if (event.data.command === 'start') {
                console.log('[AudioWorklet] Start recording command received');
                this.isRecording = true;
                this.audioChunks = [];
                this.sampleCount = 0;
                this.totalSamplesRecorded = 0;
                this.chunkSampleCount = 0;

                // Configurable chunk interval (default 5 seconds for recording)
                // For live streaming, pass a smaller value (e.g. 4096 samples)
                this.chunkInterval = event.data.chunkInterval || (16000 * 5);
                console.log(`[AudioWorklet] Chunk interval set to ${this.chunkInterval} samples`);

                this.port.postMessage({ status: 'recording' });
            } else if (event.data.command === 'stop') {
                console.log('[AudioWorklet] Stop recording command received, total samples:', this.totalSamplesRecorded);
                this.isRecording = false;

                // Send any remaining audio data
                this.flushChunks(true);  // true = final chunk

                this.audioChunks = [];
                this.sampleCount = 0;
                this.chunkSampleCount = 0;
            }
        };
    }

    /**
     * Flush accumulated chunks to main thread
     * @param {boolean} isFinal - Whether this is the final chunk (on stop)
     */
    flushChunks(isFinal = false) {
        const totalLength = this.audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);

        if (totalLength > 0) {
            const mergedData = new Int16Array(totalLength);
            let offset = 0;
            for (const chunk of this.audioChunks) {
                mergedData.set(chunk, offset);
                offset += chunk.length;
            }

            // Transfer the buffer for efficiency (zero-copy)
            this.port.postMessage({
                audioChunk: mergedData,
                chunkSampleCount: totalLength,
                totalSamplesRecorded: this.totalSamplesRecorded,
                isFinal: isFinal
            }, [mergedData.buffer]);

            // Clear the chunks after sending
            this.audioChunks = [];
            this.chunkSampleCount = 0;

            if (!isFinal) {
                console.log('[AudioWorklet] Streamed chunk:', totalLength, 'samples, total:', this.totalSamplesRecorded);
            } else {
                console.log('[AudioWorklet] Final chunk sent:', totalLength, 'samples');
            }
        } else if (isFinal) {
            // Send empty final message so main thread knows recording is complete
            console.log('[AudioWorklet] No remaining data, sending empty final');
            this.port.postMessage({
                audioChunk: new Int16Array(0),
                chunkSampleCount: 0,
                totalSamplesRecorded: this.totalSamplesRecorded,
                isFinal: true
            });
        }
    }

    /**
     * Process audio in real-time
     * Called approximately 375 times per second (128 samples @ 48kHz)
     * Or 125 times per second (128 samples @ 16kHz)
     */
    process(inputs, outputs, parameters) {
        const input = inputs[0];

        // Check if we have audio input
        if (!input || input.length === 0) {
            return true;
        }

        const inputChannel = input[0];
        if (!inputChannel || inputChannel.length === 0) {
            return true;
        }

        // Passthrough audio to output (for monitoring if needed)
        const output = outputs[0];
        if (output && output.length > 0) {
            for (let channel = 0; channel < Math.min(input.length, output.length); channel++) {
                if (output[channel] && input[channel]) {
                    output[channel].set(input[channel]);
                }
            }
        }

        // If recording, accumulate PCM16 data
        if (this.isRecording) {
            // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
            // Store as Int16Array chunk for better memory efficiency
            const samples = inputChannel;
            const pcm16Chunk = new Int16Array(samples.length);

            for (let i = 0; i < samples.length; i++) {
                // Clamp to valid range
                const s = Math.max(-1, Math.min(1, samples[i]));
                // Convert to Int16
                pcm16Chunk[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7FFF);
            }

            this.audioChunks.push(pcm16Chunk);
            this.sampleCount += samples.length;
            this.totalSamplesRecorded += samples.length;
            this.chunkSampleCount += samples.length;

            // Stream chunks periodically to avoid memory buildup or for low-latency streaming
            if (this.chunkSampleCount >= this.chunkInterval) {
                this.flushChunks(false);
            }

            // Send progress updates (every ~1 second of audio)
            if (this.sampleCount >= 16000) {
                this.port.postMessage({
                    progress: true,
                    durationSeconds: this.totalSamplesRecorded / sampleRate
                });
                this.sampleCount = 0;
            }
        }

        // Return true to keep the processor alive
        return true;
    }
}

// Register the processor with the AudioWorklet system
registerProcessor('audio-recorder', AudioRecorderWorklet);
