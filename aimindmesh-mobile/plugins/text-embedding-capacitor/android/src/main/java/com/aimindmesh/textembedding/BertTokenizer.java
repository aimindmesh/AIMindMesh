package com.aimindmesh.textembedding;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * BERT WordPiece tokenizer, following HF BertNormalizer + BertPreTokenizer: control characters
 * dropped, CJK characters split apart, optional lowercasing and accent stripping, punctuation
 * split from words, then greedy longest-match WordPiece with "##" continuations.
 * Built by TokenizerJson from tokenizer.json.
 */
public class BertTokenizer implements EmbeddingTokenizer {
    private static final int MAX_CHARS_PER_WORD = 100;

    private final Map<String, Integer> vocab;
    private final boolean lowercase;
    private final boolean stripAccents;
    private final int clsTokenId;
    private final int sepTokenId;
    private final int unkTokenId;

    BertTokenizer(Map<String, Integer> vocab, Map<String, Integer> addedTokens,
                  boolean lowercase, boolean stripAccents, String unkToken) {
        this.vocab = vocab;
        this.lowercase = lowercase;
        this.stripAccents = stripAccents;
        this.clsTokenId = idOf("[CLS]", vocab, addedTokens, 101);
        this.sepTokenId = idOf("[SEP]", vocab, addedTokens, 102);
        this.unkTokenId = idOf(unkToken != null ? unkToken : "[UNK]", vocab, addedTokens, 100);
    }

    private static int idOf(String token, Map<String, Integer> vocab, Map<String, Integer> addedTokens, int fallback) {
        Integer id = vocab.get(token);
        if (id == null) id = addedTokens.get(token);
        return id != null ? id : fallback;
    }

    @Override
    public TextEmbedder.TokenizerOutput encode(String text, int maxLength) {
        int budget = Math.max(0, maxLength - 2);
        List<Integer> tokens = new ArrayList<>();
        for (String word : preTokenize(normalize(text))) {
            if (tokens.size() >= budget) break;
            wordPiece(word, tokens);
        }
        int count = Math.min(tokens.size(), budget);
        long[] inputIds = new long[count + 2];
        inputIds[0] = clsTokenId;
        for (int i = 0; i < count; i++) inputIds[i + 1] = tokens.get(i);
        inputIds[count + 1] = sepTokenId;
        return TextEmbedder.TokenizerOutput.of(inputIds);
    }

    private String normalize(String text) {
        StringBuilder out = new StringBuilder(text.length());
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            if (cp == 0 || cp == 0xFFFD || isControl(cp)) continue;
            if (isWhitespace(cp)) {
                out.append(' ');
            } else if (isCjk(cp)) {
                out.append(' ').appendCodePoint(cp).append(' ');
            } else {
                out.appendCodePoint(cp);
            }
        }
        String normalized = out.toString();
        if (lowercase) normalized = normalized.toLowerCase(Locale.ROOT);
        if (stripAccents) {
            normalized = Normalizer.normalize(normalized, Normalizer.Form.NFD).replaceAll("\\p{Mn}+", "");
        }
        return normalized;
    }

    private static List<String> preTokenize(String text) {
        List<String> words = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            if (cp == ' ') {
                flush(current, words);
            } else if (isPunctuation(cp)) {
                flush(current, words);
                words.add(new String(Character.toChars(cp)));
            } else {
                current.appendCodePoint(cp);
            }
        }
        flush(current, words);
        return words;
    }

    private static void flush(StringBuilder current, List<String> words) {
        if (current.length() > 0) {
            words.add(current.toString());
            current.setLength(0);
        }
    }

    /** Greedy longest-match-first; a word that cannot be fully covered becomes one [UNK]. */
    private void wordPiece(String word, List<Integer> out) {
        if (word.codePointCount(0, word.length()) > MAX_CHARS_PER_WORD) {
            out.add(unkTokenId);
            return;
        }
        List<Integer> pieces = new ArrayList<>();
        int start = 0;
        while (start < word.length()) {
            int end = word.length();
            Integer found = null;
            while (start < end) {
                String sub = start > 0 ? "##" + word.substring(start, end) : word.substring(start, end);
                found = vocab.get(sub);
                if (found != null) break;
                end--;
            }
            if (found == null) {
                out.add(unkTokenId);
                return;
            }
            pieces.add(found);
            start = end;
        }
        out.addAll(pieces);
    }

    private static boolean isWhitespace(int cp) {
        return cp == ' ' || cp == '\t' || cp == '\n' || cp == '\r' || Character.getType(cp) == Character.SPACE_SEPARATOR;
    }

    private static boolean isControl(int cp) {
        if (cp == '\t' || cp == '\n' || cp == '\r') return false;
        int type = Character.getType(cp);
        return type == Character.CONTROL || type == Character.FORMAT || type == Character.PRIVATE_USE
                || type == Character.SURROGATE || type == Character.UNASSIGNED;
    }

    private static boolean isPunctuation(int cp) {
        if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
            return true;
        }
        int type = Character.getType(cp);
        return type == Character.CONNECTOR_PUNCTUATION || type == Character.DASH_PUNCTUATION
                || type == Character.START_PUNCTUATION || type == Character.END_PUNCTUATION
                || type == Character.INITIAL_QUOTE_PUNCTUATION || type == Character.FINAL_QUOTE_PUNCTUATION
                || type == Character.OTHER_PUNCTUATION;
    }

    private static boolean isCjk(int cp) {
        return (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF)
                || (cp >= 0x20000 && cp <= 0x2A6DF) || (cp >= 0x2A700 && cp <= 0x2B73F)
                || (cp >= 0x2B740 && cp <= 0x2B81F) || (cp >= 0x2B820 && cp <= 0x2CEAF)
                || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x2F800 && cp <= 0x2FA1F);
    }
}
