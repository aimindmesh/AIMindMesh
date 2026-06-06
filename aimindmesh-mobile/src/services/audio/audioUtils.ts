
/**
 * Downsamples audio data to target sample rate using linear interpolation.
 * @param buffer Input audio buffer (Float32)
 * @param inputRate Input sample rate
 * @param targetRate Target sample rate (e.g., 16000)
 * @returns Downsampled Float32Array
 */
export function downsampleBuffer(buffer: Float32Array, inputRate: number, targetRate: number): Float32Array {
    if (targetRate === inputRate) {
        return buffer;
    }
    if (targetRate > inputRate) {
        throw new Error("Upsampling not supported");
    }

    const sampleRateRatio = inputRate / targetRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);

    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < newLength) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);

        // Simple linear interpolation/averaging for downsampling
        let accum = 0;
        let count = 0;

        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }

        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }

    return result;
}

/**
 * Converts Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767).
 * @param buffer Input float buffer
 * @returns Int16Array
 */
export function floatToInt16(buffer: Float32Array): Int16Array {
    const l = buffer.length;
    const result = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        // Clamp and scale
        const s = Math.max(-1, Math.min(1, buffer[i]));
        result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return result;
}

/**
 * Converts ArrayBuffer/TypedArray to Base64 string.
 * @param buffer Input buffer
 * @returns Base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

/**
 * Decodes a WebM/Audio Blob to raw PCM (16kHz, 16-bit mono) Base64.
 * Useful for processing MediaRecorder output.
 */
export async function blobTo16kHZPCM(blob: Blob): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Get channel data (mono)
    const inputData = audioBuffer.getChannelData(0);

    // Downsample to 16kHz
    const downsampledData = downsampleBuffer(inputData, audioBuffer.sampleRate, 16000);

    // Convert to Int16
    const int16Data = floatToInt16(downsampledData);

    // Convert to Base64
    const base64 = arrayBufferToBase64(int16Data.buffer as ArrayBuffer);

    audioContext.close();
    return base64;
}
