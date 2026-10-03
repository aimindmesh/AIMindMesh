package com.aimindmesh.llama;

import java.util.ArrayList;
import java.util.List;

/**
 * Cuts streamed text at the first stop sequence. The tail that could be the start of a stop
 * sequence is held back until the next piece decides it, so a stop split across tokens is
 * never shown to the user.
 */
public final class StopSequenceFilter {
    private final String[] stops;
    private final StringBuilder pending = new StringBuilder();
    private boolean stopped = false;

    public StopSequenceFilter(String[] stopSequences) {
        List<String> valid = new ArrayList<>();
        if (stopSequences != null) {
            for (String s : stopSequences) {
                if (s != null && !s.isEmpty()) valid.add(s);
            }
        }
        this.stops = valid.toArray(new String[0]);
    }

    public boolean isStopped() {
        return stopped;
    }

    /** Adds a generated piece and returns the text that can be emitted now. */
    public String push(String piece) {
        if (stopped || piece == null || piece.isEmpty()) return "";
        if (stops.length == 0) return piece;

        pending.append(piece);
        int cut = -1;
        for (String stop : stops) {
            int idx = pending.indexOf(stop);
            if (idx >= 0 && (cut < 0 || idx < cut)) cut = idx;
        }
        if (cut >= 0) {
            String out = pending.substring(0, cut);
            pending.setLength(0);
            stopped = true;
            return out;
        }

        int hold = 0;
        for (String stop : stops) {
            int max = Math.min(stop.length() - 1, pending.length());
            for (int k = max; k > hold; k--) {
                if (endsWith(pending, stop, k)) {
                    hold = k;
                    break;
                }
            }
        }
        String out = pending.substring(0, pending.length() - hold);
        pending.delete(0, pending.length() - hold);
        return out;
    }

    /** Releases the held-back tail at the end of generation (empty once a stop was hit). */
    public String flush() {
        if (stopped) return "";
        String out = pending.toString();
        pending.setLength(0);
        return out;
    }

    private static boolean endsWith(StringBuilder text, String stop, int prefixLength) {
        int offset = text.length() - prefixLength;
        for (int i = 0; i < prefixLength; i++) {
            if (text.charAt(offset + i) != stop.charAt(i)) return false;
        }
        return true;
    }
}
