package com.aimindmesh.textembedding;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * SentencePiece Unigram tokenizer (XLM-R vocabularies such as multilingual-e5), following
 * HF tokenizers: NFKC normalization, "▁" word prefix (Metaspace), Viterbi segmentation that
 * maximizes the sum of piece scores, unknown characters scored min(score) - 10 and fused.
 */
public class UnigramTokenizer implements EmbeddingTokenizer {
    private static final String WORD_PREFIX = "▁";
    private static final float UNK_PENALTY = 10f;
    private static final int MAX_PIECE_CHARS = 64;

    private final Map<String, Integer> pieceIds;
    private final float[] scores;
    private final int unkId;
    private final int bosId;
    private final int eosId;
    private final int maxPieceLength;
    private final float unkScore;

    UnigramTokenizer(List<String> pieces, float[] scores, int unkId, Map<String, Integer> addedTokens) {
        this.scores = scores;
        this.bosId = idOf("<s>", pieces, addedTokens, 0);
        this.eosId = idOf("</s>", pieces, addedTokens, 2);
        this.unkId = unkId >= 0 ? unkId : idOf("<unk>", pieces, addedTokens, 3);

        // Control and added tokens never come out of the segmentation (HF splits them out first)
        Set<Integer> special = new HashSet<>(addedTokens.values());
        special.add(bosId);
        special.add(eosId);
        special.add(this.unkId);

        pieceIds = new HashMap<>(pieces.size() * 2);
        int longest = 1;
        float minScore = 0f;
        for (int id = 0; id < pieces.size(); id++) {
            String piece = pieces.get(id);
            if (special.contains(id) || piece.isEmpty()) continue;
            pieceIds.put(piece, id);
            longest = Math.max(longest, Math.min(piece.length(), MAX_PIECE_CHARS));
            if (id < scores.length) minScore = Math.min(minScore, scores[id]);
        }
        maxPieceLength = longest;
        unkScore = minScore - UNK_PENALTY;
    }

    private static int idOf(String token, List<String> pieces, Map<String, Integer> addedTokens, int fallback) {
        Integer added = addedTokens.get(token);
        if (added != null) return added;
        int index = pieces.indexOf(token);
        return index >= 0 ? index : fallback;
    }

    @Override
    public TextEmbedder.TokenizerOutput encode(String text, int maxLength) {
        int budget = Math.max(0, maxLength - 2);
        List<Integer> ids = new ArrayList<>();
        String normalized = normalize(text);
        if (!normalized.isEmpty()) {
            for (String word : normalized.split(" ")) {
                if (ids.size() >= budget) break;
                if (!word.isEmpty()) segment(WORD_PREFIX + word, ids);
            }
        }
        int count = Math.min(ids.size(), budget);
        long[] inputIds = new long[count + 2];
        inputIds[0] = bosId;
        for (int i = 0; i < count; i++) inputIds[i + 1] = ids.get(i);
        inputIds[count + 1] = eosId;
        return TextEmbedder.TokenizerOutput.of(inputIds);
    }

    /** NFKC (approximates the SentencePiece precompiled charsmap), no controls, single spaces. */
    static String normalize(String text) {
        String nfkc = Normalizer.normalize(text, Normalizer.Form.NFKC);
        StringBuilder out = new StringBuilder(nfkc.length());
        boolean pendingSpace = false;
        for (int i = 0; i < nfkc.length(); i++) {
            char c = nfkc.charAt(i);
            if (Character.isWhitespace(c) || Character.isSpaceChar(c)) {
                pendingSpace = true;
            } else if (!Character.isISOControl(c)) {
                if (pendingSpace && out.length() > 0) out.append(' ');
                pendingSpace = false;
                out.append(c);
            }
        }
        return out.toString();
    }

    /** Viterbi over the pieces of one "▁word": best[i] = best score of a segmentation of s[0, i). */
    private void segment(String s, List<Integer> out) {
        int n = s.length();
        float[] best = new float[n + 1];
        int[] start = new int[n + 1];
        int[] token = new int[n + 1];
        Arrays.fill(best, Float.NEGATIVE_INFINITY);
        best[0] = 0f;

        for (int i = 0; i < n; i++) {
            if (best[i] == Float.NEGATIVE_INFINITY) continue;
            int charEnd = i + Character.charCount(s.codePointAt(i));
            boolean singleCharPiece = false;
            int limit = Math.min(n, i + maxPieceLength);
            for (int end = i + 1; end <= limit; end++) {
                Integer id = pieceIds.get(s.substring(i, end));
                if (id == null) continue;
                if (end == charEnd) singleCharPiece = true;
                float score = best[i] + (id < scores.length ? scores[id] : unkScore);
                if (score > best[end]) {
                    best[end] = score;
                    start[end] = i;
                    token[end] = id;
                }
            }
            // A character no piece starts with: <unk>, so every position stays reachable
            if (!singleCharPiece) {
                float score = best[i] + unkScore;
                if (score > best[charEnd]) {
                    best[charEnd] = score;
                    start[charEnd] = i;
                    token[charEnd] = unkId;
                }
            }
        }

        if (best[n] == Float.NEGATIVE_INFINITY) {
            out.add(unkId);
            return;
        }
        List<Integer> reversed = new ArrayList<>();
        for (int pos = n; pos > 0; pos = start[pos]) reversed.add(token[pos]);
        for (int i = reversed.size() - 1; i >= 0; i--) {
            int id = reversed.get(i);
            // Consecutive unknown characters become one <unk>, as in SentencePiece
            if (id == unkId && !out.isEmpty() && out.get(out.size() - 1) == unkId) continue;
            out.add(id);
        }
    }
}
