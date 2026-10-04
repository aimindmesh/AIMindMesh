package com.aimindmesh.speakerembedding;

import java.util.Arrays;

/**
 * Helper class to extract Log-Mel Spectrogram features from raw audio.
 * Matches standard Kaldi/Torchaudio parameters:
 * - Sample Rate: 16000 Hz
 * - Window Size: 25ms (400 samples)
 * - Hop Size: 10ms (160 samples)
 * - Mel Bins: 80
 * - Window Type: Hamming
 */
/**
 * Log-Mel filterbank features as WeSpeaker computes them for its ECAPA-TDNN models
 * (torchaudio.compliance.kaldi.fbank with a Hamming window and no dither, then cepstral mean
 * normalization): 25 ms frames every 10 ms on int16-scaled audio, per-frame DC removal and
 * pre-emphasis, 512-point FFT power spectrum, 80 triangular filters on Kaldi's mel scale
 * (20 Hz - 8 kHz), log, and the per-utterance mean of each filter subtracted.
 */
public class FeatureExtractor {
    private static final int SAMPLE_RATE = 16000;
    private static final int WINDOW_SIZE = 400; // 25ms
    private static final int HOP_SIZE = 160; // 10ms
    private static final int N_FFT = 512; // Next power of 2 >= 400
    private static final int N_MELS = 80;
    private static final float F_MIN = 20.0f;
    private static final float F_MAX = SAMPLE_RATE / 2.0f;
    private static final float PREEMPHASIS = 0.97f;
    private static final float LOG_FLOOR = Math.ulp(1.0f); // FLT_EPSILON, as Kaldi

    private final float[] hammingWindow;
    private final float[][] melFilters;

    public FeatureExtractor() {
        this.hammingWindow = createHammingWindow(WINDOW_SIZE);
        this.melFilters = createMelFilters(SAMPLE_RATE, N_FFT, N_MELS, F_MIN, F_MAX);
    }

    /**
     * @param audio 16 kHz mono samples in [-1, 1]
     * @return [frames][80] normalized log-Mel features
     */
    public float[][] extractFeatures(float[] audio) {
        if (audio == null || audio.length < WINDOW_SIZE) {
            return new float[0][0];
        }
        int numFrames = (audio.length - WINDOW_SIZE) / HOP_SIZE + 1;
        float[][] features = new float[numFrames][N_MELS];
        float[] frame = new float[WINDOW_SIZE];
        float[] padded = new float[N_FFT];

        for (int i = 0; i < numFrames; i++) {
            int start = i * HOP_SIZE;
            float mean = 0;
            for (int j = 0; j < WINDOW_SIZE; j++) {
                frame[j] = audio[start + j] * 32768.0f; // the model was trained on int16-scaled audio
                mean += frame[j];
            }
            mean /= WINDOW_SIZE;
            for (int j = 0; j < WINDOW_SIZE; j++) {
                frame[j] -= mean;
            }
            for (int j = WINDOW_SIZE - 1; j > 0; j--) {
                frame[j] -= PREEMPHASIS * frame[j - 1];
            }
            frame[0] -= PREEMPHASIS * frame[0];

            java.util.Arrays.fill(padded, 0f);
            for (int j = 0; j < WINDOW_SIZE; j++) {
                padded[j] = frame[j] * hammingWindow[j];
            }
            float[] powerSpectrum = computePowerSpectrum(padded);

            for (int m = 0; m < N_MELS; m++) {
                float sum = 0;
                float[] filter = melFilters[m];
                for (int k = 0; k < filter.length; k++) {
                    sum += powerSpectrum[k] * filter[k];
                }
                features[i][m] = (float) Math.log(Math.max(sum, LOG_FLOOR));
            }
        }

        // Cepstral mean normalization over the whole segment
        for (int m = 0; m < N_MELS; m++) {
            double mean = 0;
            for (int i = 0; i < numFrames; i++) {
                mean += features[i][m];
            }
            float fm = (float) (mean / numFrames);
            for (int i = 0; i < numFrames; i++) {
                features[i][m] -= fm;
            }
        }
        return features;
    }

    private float[] createHammingWindow(int size) {
        float[] window = new float[size];
        for (int i = 0; i < size; i++) {
            window[i] = (float) (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1)));
        }
        return window;
    }

    // Simple FFT Implementation (Cooley-Tukey)
    // Input is real, output is magnitude squared (Power Spectrum)
    private float[] computePowerSpectrum(float[] realInput) {
        int n = realInput.length;
        // Complex output: [real, imag, real, imag...]
        float[] complex = new float[n * 2];
        for (int i = 0; i < n; i++) {
            complex[2 * i] = realInput[i];
            complex[2 * i + 1] = 0;
        }

        fft(complex);

        // Calculate Power Spectrum for first half (N_FFT/2 + 1)
        float[] powerSpec = new float[n / 2 + 1];
        for (int i = 0; i <= n / 2; i++) {
            float r = complex[2 * i];
            float im = complex[2 * i + 1];
            powerSpec[i] = (r * r + im * im);
        }
        return powerSpec;
    }

    // In-place FFT
    private void fft(float[] data) {
        int n = data.length / 2;
        int m = (int) (Math.log(n) / Math.log(2));

        // Bit Reversal
        int j = 0;
        for (int i = 0; i < n - 1; i++) {
            if (i < j) {
                float tr = data[2 * i];
                float ti = data[2 * i + 1];
                data[2 * i] = data[2 * j];
                data[2 * i + 1] = data[2 * j + 1];
                data[2 * j] = tr;
                data[2 * j + 1] = ti;
            }
            int k = n / 2;
            while (k <= j) {
                j -= k;
                k /= 2;
            }
            j += k;
        }

        // Butterfly Computations
        for (int i = 1; i <= m; i++) {
            int l = 1 << i;
            int l1 = l / 2;
            float u_r = 1.0f;
            float u_i = 0.0f;
            float w_r = (float) Math.cos(Math.PI / l1);
            float w_i = (float) -Math.sin(Math.PI / l1);

            for (int k = 0; k < l1; k++) {
                for (int i1 = k; i1 < n; i1 += l) {
                    int i2 = i1 + l1;
                    float tr = u_r * data[2 * i2] - u_i * data[2 * i2 + 1];
                    float ti = u_r * data[2 * i2 + 1] + u_i * data[2 * i2];

                    data[2 * i2] = data[2 * i1] - tr;
                    data[2 * i2 + 1] = data[2 * i1 + 1] - ti;

                    data[2 * i1] += tr;
                    data[2 * i1 + 1] += ti;
                }
                float temp = u_r * w_r - u_i * w_i;
                u_i = u_r * w_i + u_i * w_r;
                u_r = temp;
            }
        }
    }

    /** Kaldi's mel banks: triangles linear on the mel scale, over the first N_FFT/2 bins. */
    private float[][] createMelFilters(int sampleRate, int nFft, int nMels, float fMin, float fMax) {
        int numBins = nFft / 2;
        double melLow = kaldiMel(fMin);
        double melHigh = kaldiMel(fMax);
        double delta = (melHigh - melLow) / (nMels + 1);
        float[][] filters = new float[nMels][numBins];
        for (int m = 0; m < nMels; m++) {
            double left = melLow + m * delta;
            double center = melLow + (m + 1) * delta;
            double right = melLow + (m + 2) * delta;
            for (int k = 0; k < numBins; k++) {
                double mel = kaldiMel(k * (double) sampleRate / nFft);
                double up = (mel - left) / (center - left);
                double down = (right - mel) / (right - center);
                filters[m][k] = (float) Math.max(0, Math.min(up, down));
            }
        }
        return filters;
    }

    private static double kaldiMel(double hz) {
        return 1127.0 * Math.log(1.0 + hz / 700.0);
    }




}
