package com.aimindmesh.mobile.utils;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;

public class AudioDecoder {
    private static final String TAG = "AudioDecoder";
    private static final int TIMEOUT_US = 10000;

    public static boolean decodeToWav(File inputFile, File outputFile) {
        MediaExtractor extractor = new MediaExtractor();
        MediaCodec decoder = null;
        FileOutputStream fos = null;

        try {
            extractor.setDataSource(inputFile.getAbsolutePath());
            int audioTrackIndex = -1;
            MediaFormat format = null;
            String mime = null;

            for (int i = 0; i < extractor.getTrackCount(); i++) {
                format = extractor.getTrackFormat(i);
                mime = format.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrackIndex = i;
                    break;
                }
            }

            if (audioTrackIndex < 0)
                return false;

            extractor.selectTrack(audioTrackIndex);
            decoder = MediaCodec.createDecoderByType(mime);
            decoder.configure(format, null, null, 0);
            decoder.start();

            fos = new FileOutputStream(outputFile);

            // Write WAV Header placeholder
            fos.write(new byte[44]);

            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            boolean inputDone = false;
            boolean outputDone = false;
            int totalBytes = 0;

            int sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                    ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    : 1;

            PcmResampler resampler = new PcmResampler(sampleRate, channels);

            while (!outputDone) {
                if (!inputDone) {
                    int inputIndex = decoder.dequeueInputBuffer(TIMEOUT_US);
                    if (inputIndex >= 0) {
                        ByteBuffer inputBuffer = decoder.getInputBuffer(inputIndex);
                        int sampleSize = extractor.readSampleData(inputBuffer, 0);
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            decoder.queueInputBuffer(inputIndex, 0, sampleSize, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                int outputIndex = decoder.dequeueOutputBuffer(bufferInfo, TIMEOUT_US);
                if (outputIndex >= 0) {
                    ByteBuffer outputBuffer = decoder.getOutputBuffer(outputIndex);
                    byte[] pcm = new byte[bufferInfo.size];
                    outputBuffer.get(pcm);
                    outputBuffer.clear();

                    byte[] resampled = resampler.process(pcm, bufferInfo.size);
                    if (resampled.length > 0) {
                        fos.write(resampled);
                        totalBytes += resampled.length;
                    }

                    decoder.releaseOutputBuffer(outputIndex, false);
                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        outputDone = true;
                    }
                }
            }

            // Update WAV Header to strictly 16000Hz, 1 channel (mono), 16-bit PCM
            WavHelper.updateWavHeader(outputFile, totalBytes, totalBytes + 36, 16000, 1, 16 * 1 * 16000 / 8);

            return true;
        } catch (Exception e) {
            Log.e(TAG, "Decoding error", e);
            return false;
        } finally {
            try {
                if (fos != null)
                    fos.close();
                if (decoder != null) {
                    decoder.stop();
                    decoder.release();
                }
                extractor.release();
            } catch (Exception e) {
                // Ignore
            }
        }
    }

    public static boolean transcode(String inputPath, String outputPath) {
        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        MediaCodec decoder = null;
        MediaCodec encoder = null;

        try {
            extractor.setDataSource(inputPath);

            int audioTrackIndex = -1;
            MediaFormat inputFormat = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat format = extractor.getTrackFormat(i);
                String mime = format.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrackIndex = i;
                    inputFormat = format;
                    break;
                }
            }

            if (audioTrackIndex < 0 || inputFormat == null) {
                return false;
            }

            extractor.selectTrack(audioTrackIndex);
            String inputMime = inputFormat.getString(MediaFormat.KEY_MIME);
            int sampleRate = inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channelCount = inputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
                    ? inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    : 1;

            decoder = MediaCodec.createDecoderByType(inputMime);
            decoder.configure(inputFormat, null, null, 0);
            decoder.start();

            MediaFormat outputFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate,
                    channelCount);
            outputFormat.setInteger(MediaFormat.KEY_AAC_PROFILE,
                    android.media.MediaCodecInfo.CodecProfileLevel.AACObjectLC);
            outputFormat.setInteger(MediaFormat.KEY_BIT_RATE, 128000);
            outputFormat.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);

            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(outputFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            muxer = new MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int muxerTrackIndex = -1;
            boolean muxerStarted = false;

            MediaCodec.BufferInfo decoderBufferInfo = new MediaCodec.BufferInfo();
            MediaCodec.BufferInfo encoderBufferInfo = new MediaCodec.BufferInfo();

            boolean inputDone = false;
            boolean decoderDone = false;
            boolean encoderDone = false;

            while (!encoderDone) {
                if (!inputDone) {
                    int inputBufferIndex = decoder.dequeueInputBuffer(TIMEOUT_US);
                    if (inputBufferIndex >= 0) {
                        ByteBuffer inputBuffer = decoder.getInputBuffer(inputBufferIndex);
                        int sampleSize = extractor.readSampleData(inputBuffer, 0);
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inputBufferIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            decoder.queueInputBuffer(inputBufferIndex, 0, sampleSize, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }

                if (!decoderDone) {
                    int decoderOutputIndex = decoder.dequeueOutputBuffer(decoderBufferInfo, TIMEOUT_US);
                    if (decoderOutputIndex >= 0) {
                        ByteBuffer decoderOutputBuffer = decoder.getOutputBuffer(decoderOutputIndex);

                        if ((decoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                            decoderDone = true;
                            int encoderInputIndex = encoder.dequeueInputBuffer(TIMEOUT_US);
                            if (encoderInputIndex >= 0) {
                                encoder.queueInputBuffer(encoderInputIndex, 0, 0, 0,
                                        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            }
                        } else if (decoderBufferInfo.size > 0) {
                            int encoderInputIndex = encoder.dequeueInputBuffer(TIMEOUT_US);
                            if (encoderInputIndex >= 0) {
                                ByteBuffer encoderInputBuffer = encoder.getInputBuffer(encoderInputIndex);
                                encoderInputBuffer.clear();
                                byte[] pcmData = new byte[decoderBufferInfo.size];
                                decoderOutputBuffer.get(pcmData);
                                encoderInputBuffer.put(pcmData);
                                encoder.queueInputBuffer(encoderInputIndex, 0, pcmData.length,
                                        decoderBufferInfo.presentationTimeUs, 0);
                            }
                        }
                        decoder.releaseOutputBuffer(decoderOutputIndex, false);
                    }
                }

                int encoderOutputIndex = encoder.dequeueOutputBuffer(encoderBufferInfo, TIMEOUT_US);
                if (encoderOutputIndex >= 0) {
                    ByteBuffer encoderOutputBuffer = encoder.getOutputBuffer(encoderOutputIndex);

                    if ((encoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        encoderDone = true;
                    }

                    if ((encoderBufferInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                            && encoderBufferInfo.size > 0) {
                        if (muxerStarted) {
                            muxer.writeSampleData(muxerTrackIndex, encoderOutputBuffer, encoderBufferInfo);
                        }
                    }
                    encoder.releaseOutputBuffer(encoderOutputIndex, false);
                } else if (encoderOutputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat newFormat = encoder.getOutputFormat();
                    muxerTrackIndex = muxer.addTrack(newFormat);
                    muxer.start();
                    muxerStarted = true;
                }
            }
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Transcode error", e);
            return false;
        } finally {
            try {
                if (decoder != null) {
                    decoder.stop();
                    decoder.release();
                }
                if (encoder != null) {
                    encoder.stop();
                    encoder.release();
                }
                if (muxer != null) {
                    muxer.stop();
                    muxer.release();
                }
                extractor.release();
            } catch (Exception e) {
                // Ignore
            }
        }
    }

    public static class PcmResampler {
        private final int srcSampleRate;
        private final int srcChannels;
        private final double ratio;
        private double inputPos = 0.0;
        private short lastSample = 0;
        private boolean hasLastSample = false;

        public PcmResampler(int srcSampleRate, int srcChannels) {
            this.srcSampleRate = srcSampleRate;
            this.srcChannels = srcChannels;
            this.ratio = (double) srcSampleRate / 16000.0;
        }

        public byte[] process(byte[] pcmData, int length) {
            if (srcSampleRate == 16000 && srcChannels == 1) {
                if (length == pcmData.length) return pcmData;
                byte[] out = new byte[length];
                System.arraycopy(pcmData, 0, out, 0, length);
                return out;
            }

            int inFrames = length / (2 * srcChannels);
            if (inFrames == 0) return new byte[0];

            short[] monoSamples = new short[inFrames];
            ByteBuffer bb = ByteBuffer.wrap(pcmData, 0, length).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            for (int i = 0; i < inFrames; i++) {
                if (srcChannels == 1) {
                    monoSamples[i] = bb.getShort();
                } else {
                    int sum = 0;
                    for (int c = 0; c < srcChannels; c++) {
                        sum += bb.getShort();
                    }
                    monoSamples[i] = (short) (sum / srcChannels);
                }
            }

            if (srcSampleRate == 16000) {
                byte[] outBytes = new byte[inFrames * 2];
                ByteBuffer outBb = ByteBuffer.wrap(outBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN);
                for (int i = 0; i < inFrames; i++) {
                    outBb.putShort(monoSamples[i]);
                }
                return outBytes;
            }

            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            while (inputPos < inFrames) {
                int idx = (int) Math.floor(inputPos);
                double frac = inputPos - idx;
                short s0 = (idx == 0 && hasLastSample) ? lastSample : (idx < inFrames ? monoSamples[Math.max(0, idx)] : monoSamples[inFrames - 1]);
                short s1 = (idx + 1 < inFrames) ? monoSamples[idx + 1] : s0;
                short outVal = (short) Math.round(s0 + frac * (s1 - s0));

                baos.write(outVal & 0xFF);
                baos.write((outVal >> 8) & 0xFF);

                inputPos += ratio;
            }

            lastSample = monoSamples[inFrames - 1];
            hasLastSample = true;
            inputPos -= inFrames;

            return baos.toByteArray();
        }
    }
}
