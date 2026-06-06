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

    public static boolean encodePcmFileToAac(File pcmFile, File m4aFile, int sampleRate, int channels) {
        MediaCodec encoder = null;
        MediaMuxer muxer = null;
        FileInputStream fis = null;

        try {
            fis = new FileInputStream(pcmFile);

            // Setup Encoder
            MediaFormat outputFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate,
                    channels);
            outputFormat.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            outputFormat.setInteger(MediaFormat.KEY_BIT_RATE, 128000); // High quality for speech
            outputFormat.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);

            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            muxer = new MediaMuxer(m4aFile.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int trackIndex = -1;
            boolean muxerStarted = false;

            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            byte[] buffer = new byte[16384]; // Buffer for reading PCM
            boolean inputDone = false;
            boolean outputDone = false;

            while (!outputDone) {
                if (!inputDone) {
                    int inputBufferIndex = encoder.dequeueInputBuffer(TIMEOUT_US);
                    if (inputBufferIndex >= 0) {
                        int read = fis.read(buffer);
                        if (read == -1) {
                            encoder.queueInputBuffer(inputBufferIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            ByteBuffer inputBuffer = encoder.getInputBuffer(inputBufferIndex);
                            inputBuffer.clear();
                            inputBuffer.put(buffer, 0, read);
                            encoder.queueInputBuffer(inputBufferIndex, 0, read, System.nanoTime() / 1000, 0);
                        }
                    }
                }

                int outputBufferIndex = encoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US);
                if (outputBufferIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat newFormat = encoder.getOutputFormat();
                    trackIndex = muxer.addTrack(newFormat);
                    muxer.start();
                    muxerStarted = true;
                } else if (outputBufferIndex >= 0) {
                    ByteBuffer encodedData = encoder.getOutputBuffer(outputBufferIndex);
                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                        bufferInfo.size = 0;
                    }

                    if (bufferInfo.size != 0 && muxerStarted) {
                        encodedData.position(bufferInfo.offset);
                        encodedData.limit(bufferInfo.offset + bufferInfo.size);
                        muxer.writeSampleData(trackIndex, encodedData, bufferInfo);
                    }

                    encoder.releaseOutputBuffer(outputBufferIndex, false);

                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                    }
                }
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "PCM to AAC encoding error", e);
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
                    muxer.stop();
                    muxer.release();
                }
            } catch (Exception e) {
                // Ignore
            }
        }
    }
}
