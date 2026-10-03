package com.aimindmesh.textembedding;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads a HuggingFace tokenizer.json and builds the matching tokenizer: WordPiece (BERT,
 * MiniLM, E5, BGE) or Unigram (SentencePiece, e.g. multilingual-e5). The file is streamed:
 * a multilingual vocabulary has 250k entries and a full JSON tree of it would need ~100MB.
 */
final class TokenizerJson {

    /** The tokenizer plus the input limit of tokenizer_config.json (-1 when it does not say). */
    static final class Loaded {
        final EmbeddingTokenizer tokenizer;
        final int maxLength;

        Loaded(EmbeddingTokenizer tokenizer, int maxLength) {
            this.tokenizer = tokenizer;
            this.maxLength = maxLength;
        }
    }

    private static final class ModelData {
        String type;
        String unkToken;
        int unkId = -1;
        Map<String, Integer> vocab;   // WordPiece: token -> id
        List<String> pieces;          // Unigram: index = id
        float[] scores = new float[0];
        boolean scoredPieces;         // entries were ["piece", score] pairs
    }

    private static final class NormalizerFlags {
        boolean seen;
        boolean lowercase;
        Boolean stripAccents;
    }

    private TokenizerJson() {
    }

    static Loaded load(File tokenizerFile, File tokenizerConfigFile) throws IOException {
        ModelData model = new ModelData();
        NormalizerFlags flags = new NormalizerFlags();
        Map<String, Integer> addedTokens = new HashMap<>();
        int maxLength = -1;

        try (Reader in = new InputStreamReader(new FileInputStream(tokenizerFile), StandardCharsets.UTF_8);
             JsonReader reader = new JsonReader(in)) {
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                if ("model".equals(name) && reader.peek() == JsonToken.BEGIN_OBJECT) {
                    readModel(reader, model);
                } else if ("added_tokens".equals(name)) {
                    readAddedTokens(reader, addedTokens);
                } else if ("normalizer".equals(name)) {
                    readNormalizer(JsonParser.parseReader(reader), flags);
                } else {
                    // "truncation" is skipped too: it is a saved runtime option (128 for MiniLM),
                    // not the model's input limit
                    reader.skipValue();
                }
            }
            reader.endObject();
        } catch (RuntimeException e) {
            // Gson reports malformed content with unchecked exceptions
            throw new IOException("Invalid tokenizer.json: " + e.getMessage(), e);
        }

        // tokenizer_config.json (optional) overrides lowercasing and may cap the input length
        Boolean configLowercase = null;
        if (tokenizerConfigFile != null && tokenizerConfigFile.exists()) {
            try (Reader in = new InputStreamReader(new FileInputStream(tokenizerConfigFile), StandardCharsets.UTF_8)) {
                JsonElement root = JsonParser.parseReader(in);
                if (root.isJsonObject()) {
                    JsonObject config = root.getAsJsonObject();
                    if (config.has("do_lower_case") && config.get("do_lower_case").isJsonPrimitive()) {
                        configLowercase = config.get("do_lower_case").getAsBoolean();
                    }
                    if (config.has("model_max_length") && config.get("model_max_length").isJsonPrimitive()) {
                        double declared = config.get("model_max_length").getAsDouble();
                        // Unbounded models declare a huge sentinel value (1e30)
                        if (declared > 0 && declared < 100_000) {
                            maxLength = maxLength > 0 ? Math.min(maxLength, (int) declared) : (int) declared;
                        }
                    }
                }
            } catch (RuntimeException e) {
                throw new IOException("Invalid tokenizer_config.json: " + e.getMessage(), e);
            }
        }

        boolean unigram = "Unigram".equals(model.type) || (model.type == null && model.pieces != null && model.scoredPieces);
        if (unigram) {
            if (model.pieces == null || model.pieces.isEmpty()) {
                throw new IOException("tokenizer.json: Unigram model without vocabulary");
            }
            return new Loaded(new UnigramTokenizer(model.pieces, model.scores, model.unkId, addedTokens), maxLength);
        }
        if ("BPE".equals(model.type) || "WordLevel".equals(model.type)) {
            throw new IOException("Unsupported tokenizer type: " + model.type + " (supported: WordPiece, Unigram)");
        }
        Map<String, Integer> vocab = model.vocab;
        if (vocab == null && model.pieces != null) {
            vocab = new HashMap<>(model.pieces.size() * 2);
            for (int i = 0; i < model.pieces.size(); i++) vocab.put(model.pieces.get(i), i);
        }
        if (vocab == null || vocab.isEmpty()) {
            throw new IOException("tokenizer.json has no vocabulary");
        }
        boolean lowercase = flags.seen ? flags.lowercase : true;
        if (configLowercase != null) lowercase = configLowercase;
        // BertNormalizer: strip_accents null means "same as lowercase"
        boolean stripAccents = flags.stripAccents != null ? flags.stripAccents : lowercase;
        return new Loaded(new BertTokenizer(vocab, addedTokens, lowercase, stripAccents, model.unkToken), maxLength);
    }

    private static void readModel(JsonReader reader, ModelData model) throws IOException {
        reader.beginObject();
        while (reader.hasNext()) {
            String name = reader.nextName();
            JsonToken next = reader.peek();
            if ("type".equals(name) && next == JsonToken.STRING) {
                model.type = reader.nextString();
            } else if ("unk_token".equals(name) && next == JsonToken.STRING) {
                model.unkToken = reader.nextString();
            } else if ("unk_id".equals(name) && next == JsonToken.NUMBER) {
                model.unkId = reader.nextInt();
            } else if ("vocab".equals(name)) {
                readVocab(reader, model);
            } else {
                reader.skipValue();
            }
        }
        reader.endObject();
    }

    private static void readVocab(JsonReader reader, ModelData model) throws IOException {
        JsonToken token = reader.peek();
        if (token == JsonToken.BEGIN_OBJECT) {
            model.vocab = new HashMap<>();
            reader.beginObject();
            while (reader.hasNext()) {
                String piece = reader.nextName();
                model.vocab.put(piece, reader.nextInt());
            }
            reader.endObject();
        } else if (token == JsonToken.BEGIN_ARRAY) {
            List<String> pieces = new ArrayList<>();
            float[] scores = new float[4096];
            int count = 0;
            reader.beginArray();
            while (reader.hasNext()) {
                String piece;
                float score = 0f;
                if (reader.peek() == JsonToken.BEGIN_ARRAY) {
                    model.scoredPieces = true;
                    reader.beginArray();
                    piece = reader.nextString();
                    if (reader.hasNext()) score = (float) reader.nextDouble();
                    while (reader.hasNext()) reader.skipValue();
                    reader.endArray();
                } else {
                    piece = reader.nextString();
                }
                if (count == scores.length) scores = Arrays.copyOf(scores, count * 2);
                scores[count++] = score;
                pieces.add(piece);
            }
            reader.endArray();
            model.pieces = pieces;
            model.scores = Arrays.copyOf(scores, count);
        } else {
            reader.skipValue();
        }
    }

    private static void readAddedTokens(JsonReader reader, Map<String, Integer> out) throws IOException {
        if (reader.peek() != JsonToken.BEGIN_ARRAY) {
            reader.skipValue();
            return;
        }
        reader.beginArray();
        while (reader.hasNext()) {
            String content = null;
            int id = -1;
            reader.beginObject();
            while (reader.hasNext()) {
                String name = reader.nextName();
                if ("content".equals(name) && reader.peek() == JsonToken.STRING) {
                    content = reader.nextString();
                } else if ("id".equals(name) && reader.peek() == JsonToken.NUMBER) {
                    id = reader.nextInt();
                } else {
                    reader.skipValue();
                }
            }
            reader.endObject();
            if (content != null && id >= 0) out.put(content, id);
        }
        reader.endArray();
    }

    private static void readNormalizer(JsonElement element, NormalizerFlags flags) {
        if (element == null || !element.isJsonObject()) return;
        JsonObject normalizer = element.getAsJsonObject();
        flags.seen = true;
        String type = normalizer.has("type") && normalizer.get("type").isJsonPrimitive()
                ? normalizer.get("type").getAsString() : "";
        switch (type) {
            case "BertNormalizer":
                flags.lowercase = !normalizer.has("lowercase") || !normalizer.get("lowercase").isJsonPrimitive()
                        || normalizer.get("lowercase").getAsBoolean();
                if (normalizer.has("strip_accents") && normalizer.get("strip_accents").isJsonPrimitive()) {
                    flags.stripAccents = normalizer.get("strip_accents").getAsBoolean();
                }
                break;
            case "Lowercase":
                flags.lowercase = true;
                break;
            case "StripAccents":
                flags.stripAccents = true;
                break;
            case "Sequence":
                if (normalizer.has("normalizers") && normalizer.get("normalizers").isJsonArray()) {
                    for (JsonElement child : normalizer.getAsJsonArray("normalizers")) readNormalizer(child, flags);
                }
                break;
            default:
                break;
        }
    }
}
