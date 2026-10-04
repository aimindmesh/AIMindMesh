package com.aimindmesh.mobile.utils;

import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.nio.ByteBuffer;

public class AudioEncoder {
    private static final String TAG = "AudioEncoder";
    private static final int TIMEOUT_US = 10000;

    /** AAC-LC at 64 kbps is transparent for 16 kHz mono speech and half the size of 128 kbps. */
    public static final int DEFAULT_BIT_RATE = 64000;

    /** Encodes a raw PCM16 little-endian file (no header) to AAC-LC in an MP4 container. */
    public static boolean encodePcmFileToAac(File pcmFile, File m4aFile, int sampleRate, int channels) {
        return encodePcmToAac(pcmFile, 0, m4aFile, sampleRate, channels, DEFAULT_BIT_RATE);
    }

    /**
     * Encodes PCM16 little-endian samples read from {@code input} starting at {@code dataOffset}
     * (44 for a canonical WAV file) to AAC-LC in an MP4 container.
     *
     * Presentation timestamps come from the number of samples queued, so the resulting file
     * has an exact duration and seeks to the right position.
     */
    public static boolean encodePcmToAac(File input, long dataOffset, File m4aFile,
                                         int sampleRate, int channels, int bitRate) {
        MediaCodec encoder = null;
        MediaMuxer muxer = null;
        FileInputStream fis = null;
        boolean muxerStarted = false;
        boolean wroteSample = false;

        try {
            fis = new FileInputStream(input);
            long skipped = 0;
            while (skipped < dataOffset) {
                long s = fis.skip(dataOffset - skipped);
                if (s <= 0) {
                    break;
                }
                skipped += s;
            }

            MediaFormat outputFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate,
                    channels);
            outputFormat.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            outputFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitRate);
            outputFormat.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);

            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            muxer = new MediaMuxer(m4aFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int trackIndex = -1;

            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            int frameBytes = 2 * channels;
            byte[] buffer = new byte[16384];
            long bytesQueued = 0;
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int inputBufferIndex = encoder.dequeueInputBuffer(TIMEOUT_US);
                    if (inputBufferIndex >= 0) {
                        ByteBuffer inputBuffer = encoder.getInputBuffer(inputBufferIndex);
                        inputBuffer.clear();
                        int toRead = Math.min(buffer.length, inputBuffer.remaining());
                        toRead -= toRead % frameBytes;
                        int read = fis.read(buffer, 0, toRead);
                        long ptsUs = (bytesQueued / frameBytes) * 1_000_000L / sampleRate;
                        if (read <= 0) {
                            encoder.queueInputBuffer(inputBufferIndex, 0, 0, ptsUs,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            inputBuffer.put(buffer, 0, read);
                            encoder.queueInputBuffer(inputBufferIndex, 0, read, ptsUs, 0);
                            bytesQueued += read;
                        }
                    }
                }

                // Drain every frame the encoder has ready: one input buffer yields several AAC
                // frames, and draining only one per loop made encoding barely faster than real time.
                while (true) {
                    int outputBufferIndex = encoder.dequeueOutputBuffer(bufferInfo, inputDone ? TIMEOUT_US : 0);
                    if (outputBufferIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                        break;
                    }
                    if (outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                        if (muxerStarted) {
                            Log.e(TAG, "Format changed twice!");
                            return false;
                        }
                        trackIndex = muxer.addTrack(encoder.getOutputFormat());
                        muxer.start();
                        muxerStarted = true;
                        continue;
                    }
                    if (outputBufferIndex < 0) {
                        continue;
                    }

                    ByteBuffer outputBuffer = encoder.getOutputBuffer(outputBufferIndex);
                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && bufferInfo.size > 0
                            && muxerStarted) {
                        outputBuffer.position(bufferInfo.offset);
                        outputBuffer.limit(bufferInfo.offset + bufferInfo.size);
                        muxer.writeSampleData(trackIndex, outputBuffer, bufferInfo);
                        wroteSample = true;
                    }
                    encoder.releaseOutputBuffer(outputBufferIndex, false);

                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                        break;
                    }
                }
            }

            if (!muxerStarted) {
                return false;
            }
            // Stop here rather than in finally: a failing stop means a broken file.
            muxer.stop();
            muxerStarted = false;
            // A file without samples is not playable: let the caller fall back
            return wroteSample;
        } catch (Exception e) {
            Log.e(TAG, "Encoding failed", e);
            return false;
        } finally {
            try {
                if (fis != null)
                    fis.close();
                if (encoder != null) {
                    encoder.stop();
                    encoder.release();
                }
                if (muxer != null) {
                    if (muxerStarted) {
                        muxer.stop();
                    }
                    muxer.release();
                }
            } catch (Exception e) {
                // Ignore
            }
        }
    }
}
