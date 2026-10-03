package com.aimindmesh.llama;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class StopSequenceFilterTest {

    @Test
    public void passesTextThroughWithoutStops() {
        StopSequenceFilter filter = new StopSequenceFilter(null);
        assertEquals("Hello", filter.push("Hello"));
        assertEquals(" world", filter.push(" world"));
        assertEquals("", filter.flush());
        assertFalse(filter.isStopped());
    }

    @Test
    public void cutsAtAStopInsideOnePiece() {
        StopSequenceFilter filter = new StopSequenceFilter(new String[] { "</tool>" });
        assertEquals("call(x)", filter.push("call(x)</tool> trailing"));
        assertTrue(filter.isStopped());
        assertEquals("", filter.push("more"));
        assertEquals("", filter.flush());
    }

    @Test
    public void holdsBackAStopSplitAcrossPieces() {
        StopSequenceFilter filter = new StopSequenceFilter(new String[] { "</tool>" });
        assertEquals("abc", filter.push("abc</"));
        assertEquals("", filter.push("to"));
        assertEquals("", filter.push("ol>"));
        assertTrue(filter.isStopped());
    }

    @Test
    public void releasesAHeldPrefixThatDidNotBecomeAStop() {
        StopSequenceFilter filter = new StopSequenceFilter(new String[] { "\nUser:" });
        assertEquals("line", filter.push("line\nUs"));
        assertEquals("\nUsage", filter.push("age"));
        assertFalse(filter.isStopped());
        assertEquals("", filter.flush());
    }

    @Test
    public void flushReturnsTheHeldTailAtTheEnd() {
        StopSequenceFilter filter = new StopSequenceFilter(new String[] { "STOP" });
        assertEquals("go ", filter.push("go ST"));
        assertEquals("ST", filter.flush());
    }

    @Test
    public void earliestOfSeveralStopsWins() {
        StopSequenceFilter filter = new StopSequenceFilter(new String[] { "B", "", "A" });
        assertEquals("x", filter.push("xAyB"));
        assertTrue(filter.isStopped());
    }
}
