package com.aimindmesh.mobile.litert

import android.content.Context
import android.util.Log

private const val TAG = "LiteRTAudio"

/**
 * Audio decoding for LiteRT multimodal input (moved out of LiteRTPlugin):
 * any Android-decodable file -> 16 kHz mono PCM16 WAV, optionally split into 30 s chunks.
 */
internal object LiteRTAudio {

    fun decodeAudioToPcm(audioPath: String, context: Context): ByteArray? {
        try {
            val extractor = android.media.MediaExtractor()
            if (audioPath.startsWith("content://")) {
                val uri = android.net.Uri.parse(audioPath)
                val fd = context.contentResolver.openFileDescriptor(uri, "r")?.fileDescriptor ?: return null
                extractor.setDataSource(fd)
            } else {
                val cleanPath = if (audioPath.startsWith("file://")) audioPath.substring(7) else audioPath
                extractor.setDataSource(cleanPath)
            }

            var inputFormat: android.media.MediaFormat? = null
            var trackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(android.media.MediaFormat.KEY_MIME)
                if (mime?.startsWith("audio/") == true) {
                    inputFormat = format
                    trackIndex = i
                    break
                }
            }

            if (trackIndex < 0 || inputFormat == null) {
                Log.e(TAG, "No audio track found in $audioPath")
                return null
            }

            extractor.selectTrack(trackIndex)
            val decoder = android.media.MediaCodec.createDecoderByType(inputFormat.getString(android.media.MediaFormat.KEY_MIME)!!)
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            val bufferInfo = android.media.MediaCodec.BufferInfo()
            val outputStream = java.io.ByteArrayOutputStream()
            var isEOS = false
            
            // Default to input format, but update if output format changes
            var sampleRate = inputFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
            var channelCount = if (inputFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) 
                inputFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT) else 1

            while (true) {
                if (!isEOS) {
                    val inIndex = decoder.dequeueInputBuffer(10000)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)
                        val sampleSize = extractor.readSampleData(buffer!!, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outIndex >= 0) {
                    val outBuffer = decoder.getOutputBuffer(outIndex)
                    val chunk = ByteArray(bufferInfo.size)
                    outBuffer!!.get(chunk)
                    outBuffer.clear()
                    outputStream.write(chunk)
                    decoder.releaseOutputBuffer(outIndex, false)
                } else if (outIndex == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = decoder.outputFormat
                    // Log.d(TAG, "Output format changed: $newFormat")
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
                    }
                } else if (outIndex == android.media.MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (isEOS) break
                }
            }
            
            decoder.stop()
            decoder.release()
            extractor.release()
            
            val pcmData = outputStream.toByteArray()
            // Log.d(TAG, "Decoded PCM size: ${pcmData.size}, SampleRate: $sampleRate, Channels: $channelCount")
            
            return addWavHeader(pcmData, sampleRate, channelCount)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding audio: ${e.message}")
            return null
        }
    }

    /**
     * Decode audio and split into 30-second chunks for Gemma 3n
     * Returns list of WAV-formatted byte arrays, each ≤30 seconds
     */
    fun decodeAndChunkAudio(audioPath: String, context: Context): List<ByteArray> {
        val pcmData = decodeAudioToPcmRaw(audioPath, context) ?: return emptyList()
        
        val sampleRate = pcmData.sampleRate
        val channelCount = pcmData.channelCount
        val rawPcm = pcmData.data
        
        val TARGET_SAMPLE_RATE = 16000
        val CHUNK_SECONDS = 30
        val SAMPLES_PER_CHUNK = TARGET_SAMPLE_RATE * CHUNK_SECONDS
        
        // Convert to samples
        val numSamples = rawPcm.size / 2
        val samples = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val lo = rawPcm[i * 2].toInt() and 0xFF
            val hi = rawPcm[i * 2 + 1].toInt()
            samples[i] = ((hi shl 8) or lo).toShort()
        }
        
        // Convert stereo to mono
        val monoSamples = if (channelCount > 1) {
            val monoLen = samples.size / channelCount
            ShortArray(monoLen) { i ->
                var sum = 0
                for (ch in 0 until channelCount) {
                    sum += samples[i * channelCount + ch].toInt()
                }
                (sum / channelCount).toShort()
            }
        } else {
            samples
        }
        
        // Resample to 16kHz
        val resampledSamples = if (sampleRate != TARGET_SAMPLE_RATE) {
            resample(monoSamples, sampleRate, TARGET_SAMPLE_RATE)
        } else {
            monoSamples
        }
        
        val totalDuration = resampledSamples.size.toFloat() / TARGET_SAMPLE_RATE
        // Log.d(TAG, "Audio duration: ${String.format("%.1f", totalDuration)} seconds, will create ${kotlin.math.ceil(resampledSamples.size.toDouble() / SAMPLES_PER_CHUNK).toInt()} chunks")
        
        // Split into chunks
        val chunks = mutableListOf<ByteArray>()
        var offset = 0
        var chunkNum = 1
        
        while (offset < resampledSamples.size) {
            val remainingSamples = resampledSamples.size - offset
            val chunkSamples = minOf(remainingSamples, SAMPLES_PER_CHUNK)
            
            // Extract chunk samples
            val chunkData = ShortArray(chunkSamples)
            System.arraycopy(resampledSamples, offset, chunkData, 0, chunkSamples)
            
            // Convert to bytes
            val pcmBytes = ByteArray(chunkSamples * 2)
            for (i in 0 until chunkSamples) {
                val sample = chunkData[i].toInt()
                pcmBytes[i * 2] = (sample and 0xFF).toByte()
                pcmBytes[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
            }
            
            // Create WAV with header
            val wavData = createWavFile(pcmBytes, TARGET_SAMPLE_RATE)
            chunks.add(wavData)
            
            val chunkDuration = chunkSamples.toFloat() / TARGET_SAMPLE_RATE
            // Log.d(TAG, "Chunk $chunkNum: ${String.format("%.1f", chunkDuration)}s, ${wavData.size} bytes")
            
            offset += chunkSamples
            chunkNum++
        }
        
        return chunks
    }
    
    /**
     * Raw PCM data with metadata
     */
    private data class RawPcmData(val data: ByteArray, val sampleRate: Int, val channelCount: Int)
    
    /**
     * Decode audio to raw PCM without resampling or WAV header
     */
    private fun decodeAudioToPcmRaw(audioPath: String, context: Context): RawPcmData? {
        try {
            val extractor = android.media.MediaExtractor()
            if (audioPath.startsWith("content://")) {
                val uri = android.net.Uri.parse(audioPath)
                val fd = context.contentResolver.openFileDescriptor(uri, "r")?.fileDescriptor ?: return null
                extractor.setDataSource(fd)
            } else {
                val cleanPath = if (audioPath.startsWith("file://")) audioPath.substring(7) else audioPath
                extractor.setDataSource(cleanPath)
            }

            var inputFormat: android.media.MediaFormat? = null
            var trackIndex = -1
            for (i in 0 until extractor.trackCount) {
                val format = extractor.getTrackFormat(i)
                val mime = format.getString(android.media.MediaFormat.KEY_MIME)
                if (mime?.startsWith("audio/") == true) {
                    inputFormat = format
                    trackIndex = i
                    break
                }
            }

            if (trackIndex < 0 || inputFormat == null) {
                Log.e(TAG, "No audio track found in $audioPath")
                return null
            }

            extractor.selectTrack(trackIndex)
            val decoder = android.media.MediaCodec.createDecoderByType(inputFormat.getString(android.media.MediaFormat.KEY_MIME)!!)
            decoder.configure(inputFormat, null, null, 0)
            decoder.start()

            val bufferInfo = android.media.MediaCodec.BufferInfo()
            val outputStream = java.io.ByteArrayOutputStream()
            var isEOS = false
            
            var sampleRate = inputFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
            var channelCount = if (inputFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) 
                inputFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT) else 1

            while (true) {
                if (!isEOS) {
                    val inIndex = decoder.dequeueInputBuffer(10000)
                    if (inIndex >= 0) {
                        val buffer = decoder.getInputBuffer(inIndex)
                        val sampleSize = extractor.readSampleData(buffer!!, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, android.media.MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            isEOS = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10000)
                if (outIndex >= 0) {
                    val outBuffer = decoder.getOutputBuffer(outIndex)
                    val chunk = ByteArray(bufferInfo.size)
                    outBuffer!!.get(chunk)
                    outBuffer.clear()
                    outputStream.write(chunk)
                    decoder.releaseOutputBuffer(outIndex, false)
                } else if (outIndex == android.media.MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val newFormat = decoder.outputFormat
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(android.media.MediaFormat.KEY_SAMPLE_RATE)
                    }
                    if (newFormat.containsKey(android.media.MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(android.media.MediaFormat.KEY_CHANNEL_COUNT)
                    }
                } else if (outIndex == android.media.MediaCodec.INFO_TRY_AGAIN_LATER) {
                    if (isEOS) break
                }
            }
            
            decoder.stop()
            decoder.release()
            extractor.release()
            
            val pcmData = outputStream.toByteArray()
            Log.d(TAG, "Decoded raw PCM: ${pcmData.size} bytes, ${sampleRate}Hz, ${channelCount}ch")
            
            return RawPcmData(pcmData, sampleRate, channelCount)
        } catch (e: Exception) {
            Log.e(TAG, "Error decoding audio: ${e.message}")
            return null
        }
    }
    
    /**
     * Create WAV file from 16kHz mono PCM16 data
     */
    private fun createWavFile(pcmData: ByteArray, sampleRate: Int): ByteArray {
        val totalDataLen = pcmData.size.toLong()
        val byteRate = sampleRate * 2  // 16-bit mono
        
        val header = ByteArray(44)
        
        // RIFF header
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        
        // Match gallery format: wavFileSize = pcmDataSize + 44 (full file size)
        val wavFileSize = totalDataLen + 44
        header[4] = (wavFileSize and 0xff).toByte()
        header[5] = ((wavFileSize shr 8) and 0xff).toByte()
        header[6] = ((wavFileSize shr 16) and 0xff).toByte()
        header[7] = ((wavFileSize shr 24) and 0xff).toByte()
        
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0
        header[20] = 1; header[21] = 0  // PCM format
        header[22] = 1; header[23] = 0  // Mono
        
        header[24] = (sampleRate and 0xff).toByte()
        header[25] = ((sampleRate shr 8) and 0xff).toByte()
        header[26] = ((sampleRate shr 16) and 0xff).toByte()
        header[27] = ((sampleRate shr 24) and 0xff).toByte()
        
        header[28] = (byteRate and 0xff).toByte()
        header[29] = ((byteRate shr 8) and 0xff).toByte()
        header[30] = ((byteRate shr 16) and 0xff).toByte()
        header[31] = ((byteRate shr 24) and 0xff).toByte()
        
        header[32] = 2; header[33] = 0  // Block align
        header[34] = 16; header[35] = 0  // Bits per sample
        
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        
        header[40] = (totalDataLen and 0xff).toByte()
        header[41] = ((totalDataLen shr 8) and 0xff).toByte()
        header[42] = ((totalDataLen shr 16) and 0xff).toByte()
        header[43] = ((totalDataLen shr 24) and 0xff).toByte()
        
        return header + pcmData
    }
    
    /**
     * Simple linear interpolation resampling
     */
    private fun resample(input: ShortArray, fromRate: Int, toRate: Int): ShortArray {
        val ratio = fromRate.toDouble() / toRate.toDouble()
        val outputLen = (input.size / ratio).toInt()
        val output = ShortArray(outputLen)
        
        for (i in 0 until outputLen) {
            val srcPos = i * ratio
            val srcIndex = srcPos.toInt()
            val frac = srcPos - srcIndex
            
            val sample1 = input[minOf(srcIndex, input.size - 1)].toInt()
            val sample2 = input[minOf(srcIndex + 1, input.size - 1)].toInt()
            
            output[i] = (sample1 + (sample2 - sample1) * frac).toInt().toShort()
        }
        
        Log.d(TAG, "Resampled from $fromRate Hz to $toRate Hz: ${input.size} -> ${output.size} samples")
        return output
    }

    /**
     * Create a WAV file with 16kHz mono PCM16 format for Gemma 3n
     * This format is required by LiteRT's miniaudio decoder
     */
    private fun addWavHeader(pcmData: ByteArray, sampleRate: Int, channels: Int): ByteArray {
        val TARGET_SAMPLE_RATE = 16000
        
        // Step 1: Convert bytes to 16-bit samples
        val numSamples = pcmData.size / 2
        val samples = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val lo = pcmData[i * 2].toInt() and 0xFF
            val hi = pcmData[i * 2 + 1].toInt()
            samples[i] = ((hi shl 8) or lo).toShort()
        }
        
        // Step 2: Convert stereo to mono if needed
        val monoSamples = if (channels > 1) {
            val monoLen = samples.size / channels
            ShortArray(monoLen) { i ->
                var sum = 0
                for (ch in 0 until channels) {
                    sum += samples[i * channels + ch].toInt()
                }
                (sum / channels).toShort()
            }
        } else {
            samples
        }
        
        // Step 3: Resample to 16kHz if needed
        val resampledSamples = if (sampleRate != TARGET_SAMPLE_RATE) {
            resample(monoSamples, sampleRate, TARGET_SAMPLE_RATE)
        } else {
            monoSamples
        }
        
        // Step 4: Convert back to bytes
        val resampledPcm = ByteArray(resampledSamples.size * 2)
        for (i in resampledSamples.indices) {
            val sample = resampledSamples[i].toInt()
            resampledPcm[i * 2] = (sample and 0xFF).toByte()
            resampledPcm[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
        }
        
        Log.d(TAG, "Prepared audio for Gemma 3n: ${resampledPcm.size} bytes PCM, ${resampledSamples.size} samples at 16kHz mono")
        
        // Step 5: Create WAV header for 16kHz mono 16-bit PCM
        val totalDataLen = resampledPcm.size.toLong()
        val byteRate = (16 * TARGET_SAMPLE_RATE * 1) / 8  // 16-bit, 16kHz, mono
        
        val header = ByteArray(44)
        
        // RIFF header
        header[0] = 'R'.code.toByte()
        header[1] = 'I'.code.toByte()
        header[2] = 'F'.code.toByte()
        header[3] = 'F'.code.toByte()
        
        // Match gallery format: wavFileSize = pcmDataSize + 44 (full file size)
        val wavFileSize = totalDataLen + 44
        header[4] = (wavFileSize and 0xff).toByte()
        header[5] = ((wavFileSize shr 8) and 0xff).toByte()
        header[6] = ((wavFileSize shr 16) and 0xff).toByte()
        header[7] = ((wavFileSize shr 24) and 0xff).toByte()
        
        // WAVE format
        header[8] = 'W'.code.toByte()
        header[9] = 'A'.code.toByte()
        header[10] = 'V'.code.toByte()
        header[11] = 'E'.code.toByte()
        
        // fmt subchunk
        header[12] = 'f'.code.toByte()
        header[13] = 'm'.code.toByte()
        header[14] = 't'.code.toByte()
        header[15] = ' '.code.toByte()
        
        // Subchunk1Size (16 for PCM)
        header[16] = 16
        header[17] = 0
        header[18] = 0
        header[19] = 0
        
        // AudioFormat (1 = PCM)
        header[20] = 1
        header[21] = 0
        
        // NumChannels (1 = mono)
        header[22] = 1
        header[23] = 0
        
        // SampleRate (16000)
        header[24] = (TARGET_SAMPLE_RATE and 0xff).toByte()
        header[25] = ((TARGET_SAMPLE_RATE shr 8) and 0xff).toByte()
        header[26] = ((TARGET_SAMPLE_RATE shr 16) and 0xff).toByte()
        header[27] = ((TARGET_SAMPLE_RATE shr 24) and 0xff).toByte()
        
        // ByteRate
        header[28] = (byteRate and 0xff).toByte()
        header[29] = ((byteRate shr 8) and 0xff).toByte()
        header[30] = ((byteRate shr 16) and 0xff).toByte()
        header[31] = ((byteRate shr 24) and 0xff).toByte()
        
        // BlockAlign (2 = 16-bit mono)
        header[32] = 2
        header[33] = 0
        
        // BitsPerSample (16)
        header[34] = 16
        header[35] = 0
        
        // data subchunk
        header[36] = 'd'.code.toByte()
        header[37] = 'a'.code.toByte()
        header[38] = 't'.code.toByte()
        header[39] = 'a'.code.toByte()
        
        // Subchunk2Size
        header[40] = (totalDataLen and 0xff).toByte()
        header[41] = ((totalDataLen shr 8) and 0xff).toByte()
        header[42] = ((totalDataLen shr 16) and 0xff).toByte()
        header[43] = ((totalDataLen shr 24) and 0xff).toByte()
        
        Log.d(TAG, "Created WAV file: ${header.size + resampledPcm.size} bytes total (16kHz mono PCM16)")
        return header + resampledPcm
    }
}
