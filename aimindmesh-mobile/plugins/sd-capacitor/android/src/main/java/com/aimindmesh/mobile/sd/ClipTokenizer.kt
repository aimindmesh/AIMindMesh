package com.aimindmesh.mobile.sd

import android.content.Context
import org.json.JSONObject
import java.io.InputStream
import java.util.regex.Pattern

data class TokenizedPrompt(
    val tokens: IntArray,
    val weights: FloatArray,
    /** The prompt did not fit in the 75 usable tokens: the tail was dropped */
    val truncated: Boolean = false
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is TokenizedPrompt) return false
        return tokens.contentEquals(other.tokens) && weights.contentEquals(other.weights) && truncated == other.truncated
    }

    override fun hashCode(): Int = 31 * tokens.contentHashCode() + weights.contentHashCode()
}

/**
 * CLIP BPE tokenizer (OpenAI CLIP / OpenCLIP share the vocabulary): 77 tokens with start and end
 * markers. Padding differs: SD 1.x pads with the end token, SD 2.x with "!" (id 0).
 */
class ClipTokenizer(
    private val vocab: Map<String, Int>,
    merges: List<Pair<String, String>>
) {
    companion object {
        const val CONTEXT_LENGTH = 77
        const val START_TOKEN_ID = 49406
        const val END_TOKEN_ID = 49407
        /** "!" — the pad token of the SD 2.x (OpenCLIP) tokenizer */
        const val SD2_PAD_TOKEN_ID = 0
        /** A1111 conventions: (text) = x1.1, [text] = /1.1 */
        const val EMPHASIS = 1.1f

        private val PATTERN = Pattern.compile(
            """<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""",
            Pattern.CASE_INSENSITIVE
        )
        private val WEIGHTED = Regex("""\(([^():]+):\s*([0-9]*\.?[0-9]+)\s*\)|\(([^()]+)\)|\[([^\[\]]+)]|([^()\[\]]+)""")

        fun fromAssets(context: Context): ClipTokenizer =
            context.assets.open("sd_tokenizer/vocab.json").use { vocab ->
                context.assets.open("sd_tokenizer/merges.txt").use { merges -> fromStreams(vocab, merges) }
            }

        fun fromStreams(vocabStream: InputStream, mergesStream: InputStream): ClipTokenizer {
            val json = JSONObject(vocabStream.readBytes().toString(Charsets.UTF_8))
            val vocab = HashMap<String, Int>(json.length() * 2)
            for (key in json.keys()) vocab[key] = json.getInt(key)
            val merges = mergesStream.bufferedReader(Charsets.UTF_8).readLines()
                .map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .mapNotNull { line -> line.split(Regex("\\s+")).takeIf { it.size == 2 }?.let { it[0] to it[1] } }
            return ClipTokenizer(vocab, merges)
        }
    }

    private val bpeRanks: Map<Pair<String, String>, Int> = merges.withIndex().associate { (i, p) -> p to i }
    private val byteEncoder: Map<Int, Char> = buildByteEncoder()
    private val cache = HashMap<String, List<String>>()

    init {
        require(vocab["<|endoftext|>"] == END_TOKEN_ID && vocab["<|startoftext|>"] == START_TOKEN_ID) {
            "Not a CLIP vocabulary"
        }
    }

    private fun buildByteEncoder(): Map<Int, Char> {
        val bs = mutableListOf<Int>()
        bs.addAll('!'.code..'~'.code)
        bs.addAll('¡'.code..'¬'.code)
        bs.addAll('®'.code..'ÿ'.code)
        val cs = bs.toMutableList()
        var n = 0
        for (b in 0..255) {
            if (b !in bs) {
                bs.add(b)
                cs.add(256 + n)
                n++
            }
        }
        return bs.indices.associate { bs[it] to cs[it].toChar() }
    }

    private data class WeightedChunk(val text: String, val weight: Float)

    private fun parsePromptWeights(prompt: String): List<WeightedChunk> {
        val chunks = WEIGHTED.findAll(prompt).mapNotNull { m ->
            val g = m.groupValues
            when {
                g[1].isNotBlank() -> WeightedChunk(g[1], g[2].toFloatOrNull()?.coerceIn(0f, 3f) ?: 1f)
                g[3].isNotBlank() -> WeightedChunk(g[3], EMPHASIS)
                g[4].isNotBlank() -> WeightedChunk(g[4], 1f / EMPHASIS)
                g[5].isNotBlank() -> WeightedChunk(g[5], 1f)
                else -> null
            }
        }.toList()
        return chunks.ifEmpty { if (prompt.isNotBlank()) listOf(WeightedChunk(prompt, 1f)) else emptyList() }
    }

    /** Tokens [77] and per-token weights for a prompt such as `a (small:1.4) mouse, [blurry]`. */
    fun encodeWithWeights(text: String, padTokenId: Int = SD2_PAD_TOKEN_ID): TokenizedPrompt {
        val tokens = IntArray(CONTEXT_LENGTH) { padTokenId }
        val weights = FloatArray(CONTEXT_LENGTH) { 1.0f }
        tokens[0] = START_TOKEN_ID
        var index = 1
        var truncated = false

        for (chunk in parsePromptWeights(text)) {
            val cleaned = chunk.text.lowercase().trim().replace(Regex("\\s+"), " ")
            val matcher = PATTERN.matcher(cleaned)
            while (matcher.find()) {
                for (id in tokenizeWord(matcher.group())) {
                    if (index >= CONTEXT_LENGTH - 1) {
                        truncated = true
                        break
                    }
                    tokens[index] = id
                    weights[index] = chunk.weight
                    index++
                }
                if (truncated) break
            }
            if (truncated) break
        }
        tokens[index] = END_TOKEN_ID
        return TokenizedPrompt(tokens, weights, truncated)
    }

    fun encode(text: String, padTokenId: Int = SD2_PAD_TOKEN_ID): IntArray = encodeWithWeights(text, padTokenId).tokens

    private fun tokenizeWord(word: String): List<Int> {
        val token = buildString {
            for (b in word.toByteArray(Charsets.UTF_8)) append(byteEncoder.getValue(b.toInt() and 0xFF))
        }
        return bpe(token).map { vocab[it] ?: END_TOKEN_ID }
    }

    private fun pairsOf(word: List<String>): Set<Pair<String, String>> =
        (0 until word.size - 1).mapTo(HashSet()) { word[it] to word[it + 1] }

    private fun bpe(token: String): List<String> {
        cache[token]?.let { return it }
        if (token.isEmpty()) return emptyList()
        var word: List<String> = token.dropLast(1).map { it.toString() } + (token.last() + "</w>")
        while (word.size > 1) {
            val best = pairsOf(word).minByOrNull { bpeRanks[it] ?: Int.MAX_VALUE } ?: break
            if (best !in bpeRanks) break
            val merged = ArrayList<String>(word.size)
            var i = 0
            while (i < word.size) {
                if (i < word.size - 1 && word[i] == best.first && word[i + 1] == best.second) {
                    merged.add(best.first + best.second)
                    i += 2
                } else {
                    merged.add(word[i])
                    i++
                }
            }
            word = merged
        }
        cache[token] = word
        return word
    }
}
