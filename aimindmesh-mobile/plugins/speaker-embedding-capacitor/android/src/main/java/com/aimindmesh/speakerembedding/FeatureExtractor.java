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
public class FeatureExtractor {

    private static final int SAMPLE_RATE = 16000;
    private static final int WINDOW_SIZE = 400; // 25ms
    private static final int HOP_SIZE = 160; // 10ms
    private static final int N_FFT = 512; // Next power of 2 >= 400
    private static final int N_MELS = 80;
    private static final float F_MIN = 20.0f;
    private static final float F_MAX = 7600.0f; // Nyquist is 8000

    private final float[] hammingWindow;
    private final float[][] melFilters;

    public FeatureExtractor() {
        this.hammingWindow = createHammingWindow(WINDOW_SIZE);
        this.melFilters = createMelFilters(SAMPLE_RATE, N_FFT, N_MELS, F_MIN, F_MAX);
    }

    /**
     * Extracts Log-Mel Filterbank features from audio samples.
     * 
     * @param audio Audio samples (16kHz, normalized -1.0 to 1.0)
     * @return 2D array [Frames][80]
     */
    public float[][] extractFeatures(float[] audio) {
        if (audio == null || audio.length < WINDOW_SIZE) {
            return new float[0][0];
        }

        // Pre-emphasis (standard coefficient 0.97)
        float[] emphasizedAudio = preEmphasis(audio, 0.97f);

        int numFrames = (emphasizedAudio.length - WINDOW_SIZE) / HOP_SIZE + 1;
        if (numFrames <= 0)
            return new float[0][0];

        float[][] features = new float[numFrames][N_MELS];

        for (int i = 0; i < numFrames; i++) {
            int start = i * HOP_SIZE;
            float[] frame = new float[N_FFT]; // Zero-padded by default

            // Apply window
            for (int j = 0; j < WINDOW_SIZE; j++) {
                if (start + j < emphasizedAudio.length) {
                    frame[j] = emphasizedAudio[start + j] * hammingWindow[j];
                }
            }

            // FFT
            float[] powerSpectrum = computePowerSpectrum(frame);

            // Apply Mel Filterbank
            for (int m = 0; m < N_MELS; m++) {
                float sum = 0;
                for (int k = 0; k < N_FFT / 2 + 1; k++) {
                    sum += powerSpectrum[k] * melFilters[m][k];
                }
                // Log (with small offset to avoid log(0))
                features[i][m] = (float) Math.log(Math.max(sum, 1e-7));
            }
        }

        return features;
    }

    private float[] preEmphasis(float[] audio, float coeff) {
        float[] result = new float[audio.length];
        if (audio.length == 0)
            return result;
        result[0] = audio[0];
        for (int i = 1; i < audio.length; i++) {
            result[i] = audio[i] - coeff * audio[i - 1];
        }
        return result;
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

    private float[][] createMelFilters(int sampleRate, int nFft, int nMels, float fMin, float fMax) {
        float[] melPoints = new float[nMels + 2];
        float melMin = hzToMel(fMin);
        float melMax = hzToMel(fMax);
        float step = (melMax - melMin) / (nMels + 1);

        for (int i = 0; i < melPoints.length; i++) {
            melPoints[i] = melToHz(melMin + i * step);
        }

        float[][] filters = new float[nMels][nFft / 2 + 1];

        for (int m = 0; m < nMels; m++) {
            float fLeft = melPoints[m];
            float fCenter = melPoints[m + 1];
            float fRight = melPoints[m + 2];

            for (int k = 0; k < nFft / 2 + 1; k++) {
                float hz = (k * sampleRate) / (float) nFft;
                if (hz >= fLeft && hz <= fCenter) {
                    filters[m][k] = (hz - fLeft) / (fCenter - fLeft);
                } else if (hz > fCenter && hz <= fRight) {
                    filters[m][k] = (fRight - hz) / (fRight - fCenter);
                } else {
                    filters[m][k] = 0;
                }
            }
        }
        return filters;
    }

    private float hzToMel(float hz) {
        return (float) (2595 * Math.log10(1 + hz / 700));
    }

    private float melToHz(float mel) {
        return (float) (700 * (Math.pow(10, mel / 2595) - 1));
    }
}
