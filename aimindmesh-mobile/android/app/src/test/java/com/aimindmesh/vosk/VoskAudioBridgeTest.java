package com.aimindmesh.vosk;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class VoskAudioBridgeTest {

    @After
    public void clear() {
        VoskAudioBridge.setSink(null);
    }

    @Test
    public void feedWithoutRecognizerDoesNothing() {
        assertFalse(VoskAudioBridge.isActive());
        VoskAudioBridge.feed(new short[10], 10, 0); // no exception
    }

    @Test
    public void forwardsAudioWithItsOffset() {
        List<Long> offsets = new ArrayList<>();
        VoskAudioBridge.setSink((samples, length, offset) -> offsets.add(offset + length));
        assertTrue(VoskAudioBridge.isActive());
        VoskAudioBridge.feed(new short[160], 160, 16000);
        assertEquals(Long.valueOf(16160), offsets.get(0));
    }

    @Test
    public void onlyTheRegisteredSinkCanUnregister() {
        VoskAudioBridge.Sink first = (s, l, o) -> { };
        VoskAudioBridge.Sink second = (s, l, o) -> { };
        VoskAudioBridge.setSink(first);
        VoskAudioBridge.setSink(second);
        VoskAudioBridge.clearSink(first); // a stale recognizer stopping late
        assertTrue(VoskAudioBridge.isActive());
        VoskAudioBridge.clearSink(second);
        assertFalse(VoskAudioBridge.isActive());
    }
}
