package com.aimindmesh.textembedding;

/**
 * Turns text into model inputs: [start token] + tokens + [end token], at most maxLength ids.
 * Implemented by BertTokenizer (WordPiece) and UnigramTokenizer (SentencePiece).
 */
public interface EmbeddingTokenizer {
    TextEmbedder.TokenizerOutput encode(String text, int maxLength);
}
