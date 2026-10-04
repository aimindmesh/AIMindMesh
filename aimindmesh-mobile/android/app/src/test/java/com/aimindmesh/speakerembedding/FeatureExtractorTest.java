package com.aimindmesh.speakerembedding;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Random;

public class FeatureExtractorTest {

    private static float[] tone(int samples, double hz, long seed) {
        Random noise = new Random(seed);
        float[] audio = new float[samples];
        for (int i = 0; i < samples; i++) {
            audio[i] = (float) (0.3 * Math.sin(2 * Math.PI * hz * i / 16000.0) + 0.01 * noise.nextGaussian());
        }
        return audio;
    }

    @Test
    public void framesAreKaldiSnipEdges() {
        // 25 ms windows every 10 ms, no padding: (16000 - 400) / 160 + 1
        float[][] f = new FeatureExtractor().extractFeatures(tone(16000, 440, 1));
        assertEquals(98, f.length);
        assertEquals(80, f[0].length);
    }

    @Test
    public void eachFilterHasZeroMeanAndFiniteValues() {
        float[][] f = new FeatureExtractor().extractFeatures(tone(48000, 220, 2));
        for (int m = 0; m < 80; m++) {
            double sum = 0;
            for (float[] frame : f) {
                assertTrue(Float.isFinite(frame[m]));
                sum += frame[m];
            }
            assertEquals(0.0, sum / f.length, 1e-3);
        }
    }

    @Test
    public void tooShortAudioGivesNoFrames() {
        assertEquals(0, new FeatureExtractor().extractFeatures(new float[399]).length);
    }
}
