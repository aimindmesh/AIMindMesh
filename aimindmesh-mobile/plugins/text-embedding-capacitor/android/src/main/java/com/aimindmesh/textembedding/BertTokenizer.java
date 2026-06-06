package com.aimindmesh.textembedding;

import android.util.Log;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * BERT-style tokenizer for HuggingFace models.
 * Loads vocabulary and tokenizer config from tokenizer.json and
 * tokenizer_config.json
 */
public class BertTokenizer {
    private static final String TAG = "BertTokenizer";

    // Special tokens
    private static final String CLS_TOKEN = "[CLS]";
    private static final String SEP_TOKEN = "[SEP]";
    private static final String UNK_TOKEN = "[UNK]";
    private static final String PAD_TOKEN = "[PAD]";

    private Map<String, Integer> vocab;
    private int clsTokenId = 101;
    private int sepTokenId = 102;
    private int unkTokenId = 100;
    private int padTokenId = 0;
    private boolean doLowerCase = true;

    public BertTokenizer(File tokenizerFile, File tokenizerConfigFile) throws IOException {
        loadTokenizer(tokenizerFile);
        if (tokenizerConfigFile != null && tokenizerConfigFile.exists()) {
            loadTokenizerConfig(tokenizerConfigFile);
        }
    }

    private void loadTokenizer(File tokenizerFile) throws IOException {
        Gson gson = new Gson();
        try (FileReader reader = new FileReader(tokenizerFile)) {
            JsonObject root = gson.fromJson(reader, JsonObject.class);

            vocab = new HashMap<>();

            // Handle HuggingFace tokenizer.json format
            if (root.has("model") && root.getAsJsonObject("model").has("vocab")) {
                JsonObject vocabObj = root.getAsJsonObject("model").getAsJsonObject("vocab");
                for (Map.Entry<String, JsonElement> entry : vocabObj.entrySet()) {
                    vocab.put(entry.getKey(), entry.getValue().getAsInt());
                }
            } else if (root.has("vocab")) {
                // Simple vocab format
                JsonObject vocabObj = root.getAsJsonObject("vocab");
                for (Map.Entry<String, JsonElement> entry : vocabObj.entrySet()) {
                    vocab.put(entry.getKey(), entry.getValue().getAsInt());
                }
            }

            // Get special token IDs
            if (root.has("added_tokens")) {
                JsonArray addedTokens = root.getAsJsonArray("added_tokens");
                for (JsonElement elem : addedTokens) {
                    JsonObject tokenObj = elem.getAsJsonObject();
                    String content = tokenObj.get("content").getAsString();
                    int id = tokenObj.get("id").getAsInt();

                    if (content.equals(CLS_TOKEN) || content.equals("[CLS]")) {
                        clsTokenId = id;
                    } else if (content.equals(SEP_TOKEN) || content.equals("[SEP]")) {
                        sepTokenId = id;
                    } else if (content.equals(UNK_TOKEN) || content.equals("[UNK]")) {
                        unkTokenId = id;
                    } else if (content.equals(PAD_TOKEN) || content.equals("[PAD]")) {
                        padTokenId = id;
                    }
                }
            }

            // Fallback: get from vocab directly
            if (vocab.containsKey(CLS_TOKEN))
                clsTokenId = vocab.get(CLS_TOKEN);
            if (vocab.containsKey(SEP_TOKEN))
                sepTokenId = vocab.get(SEP_TOKEN);
            if (vocab.containsKey(UNK_TOKEN))
                unkTokenId = vocab.get(UNK_TOKEN);
            if (vocab.containsKey(PAD_TOKEN))
                padTokenId = vocab.get(PAD_TOKEN);

            Log.i(TAG, "Loaded vocab with " + vocab.size() + " tokens");
            Log.i(TAG, "Special tokens: CLS=" + clsTokenId + ", SEP=" + sepTokenId +
                    ", UNK=" + unkTokenId + ", PAD=" + padTokenId);
        }
    }

    private void loadTokenizerConfig(File configFile) throws IOException {
        Gson gson = new Gson();
        try (FileReader reader = new FileReader(configFile)) {
            JsonObject config = gson.fromJson(reader, JsonObject.class);
            if (config.has("do_lower_case")) {
                doLowerCase = config.get("do_lower_case").getAsBoolean();
            }
        }
    }

    /**
     * Encode text to token IDs with attention mask
     */
    public TextEmbedder.TokenizerOutput encode(String text, int maxLength) {
        // Preprocess
        if (doLowerCase) {
            text = text.toLowerCase();
        }

        // Simple whitespace + punctuation tokenization
        // For production, implement proper WordPiece/BPE tokenization
        List<Integer> tokens = tokenize(text);

        // Truncate if needed (accounting for [CLS] and [SEP])
        int maxTokens = maxLength - 2;
        if (tokens.size() > maxTokens) {
            tokens = tokens.subList(0, maxTokens);
        }

        // Build final sequence: [CLS] + tokens + [SEP]
        List<Integer> inputIds = new ArrayList<>();
        inputIds.add(clsTokenId);
        inputIds.addAll(tokens);
        inputIds.add(sepTokenId);

        int seqLen = inputIds.size();

        // Create attention mask (1 for real tokens, 0 for padding)
        long[] attentionMask = new long[seqLen];
        for (int i = 0; i < seqLen; i++) {
            attentionMask[i] = 1;
        }

        // Token type IDs (all 0 for single sequence)
        long[] tokenTypeIds = new long[seqLen];

        // Convert to long array
        long[] inputIdsArray = new long[seqLen];
        for (int i = 0; i < seqLen; i++) {
            inputIdsArray[i] = inputIds.get(i);
        }

        TextEmbedder.TokenizerOutput output = new TextEmbedder.TokenizerOutput();
        output.inputIds = inputIdsArray;
        output.attentionMask = attentionMask;
        output.tokenTypeIds = tokenTypeIds;

        return output;
    }

    /**
     * Simple WordPiece-style tokenization
     */
    private List<Integer> tokenize(String text) {
        List<Integer> tokens = new ArrayList<>();

        // Split on whitespace
        String[] words = text.split("\\s+");

        for (String word : words) {
            if (word.isEmpty())
                continue;

            // Check if whole word is in vocab
            if (vocab.containsKey(word)) {
                tokens.add(vocab.get(word));
            } else {
                // Try WordPiece: split into subwords
                List<Integer> subTokens = wordPieceTokenize(word);
                tokens.addAll(subTokens);
            }
        }

        return tokens;
    }

    /**
     * WordPiece tokenization for a single word
     */
    private List<Integer> wordPieceTokenize(String word) {
        List<Integer> tokens = new ArrayList<>();

        int start = 0;
        while (start < word.length()) {
            int end = word.length();
            Integer foundToken = null;
            String subword = null;

            while (start < end) {
                subword = word.substring(start, end);
                if (start > 0) {
                    subword = "##" + subword;
                }

                if (vocab.containsKey(subword)) {
                    foundToken = vocab.get(subword);
                    break;
                }
                end--;
            }

            if (foundToken != null) {
                tokens.add(foundToken);
                start = end;
            } else {
                // Character not found, use UNK and move forward
                tokens.add(unkTokenId);
                start++;
            }
        }

        return tokens;
    }
}
