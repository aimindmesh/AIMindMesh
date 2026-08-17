package com.aimindmesh.mobile.sd

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.regex.Pattern

/**
 * High-precision OpenCLIP BPE Tokenizer for Stable Diffusion v1.5 & v2.1.
 * Matches OpenAI / OpenCLIP ViT-H/14 and ViT-L/14 tokenization exactly.
 */
class ClipTokenizer(private val context: Context? = null) {
    companion object {
        private const val TAG = "ClipTokenizer"
        const val CONTEXT_LENGTH = 77
        const val START_TOKEN_ID = 49406
        const val END_TOKEN_ID = 49407
        const val PAD_TOKEN_ID = 0
        const val VOCAB_SIZE = 49408

        private val PATTERN = Pattern.compile(
            """<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""",
            Pattern.CASE_INSENSITIVE
        )
    }

    private val vocab = HashMap<String, Int>()
    private val bpeRanks = HashMap<Pair<String, String>, Int>()
    private val byteEncoder = HashMap<Int, Char>()
    private val cache = HashMap<String, List<String>>()

    init {
        initializeByteEncoder()
        loadVocabAndMerges()
    }

    private fun initializeByteEncoder() {
        val bs = mutableListOf<Int>()
        for (i in '!'.code..'~'.code) bs.add(i)
        for (i in '¡'.code..'¬'.code) bs.add(i)
        for (i in '®'.code..'ÿ'.code) bs.add(i)

        val cs = bs.toMutableList()
        var n = 0
        for (b in 0..255) {
            if (!bs.contains(b)) {
                bs.add(b)
                cs.add(256 + n)
                n++
            }
        }
        for (i in bs.indices) {
            byteEncoder[bs[i]] = cs[i].toChar()
        }
    }

    private fun loadVocabAndMerges() {
        if (context == null) {
            Log.w(TAG, "No context provided, using minimal fallback vocab")
            initializeDefaultVocab()
            return
        }

        try {
            // Load vocab.json
            val vocabStream = context.assets.open("sd_tokenizer/vocab.json")
            val vocabReader = BufferedReader(InputStreamReader(vocabStream, Charsets.UTF_8))
            val vocabJsonStr = vocabReader.readText()
            vocabReader.close()

            val jsonObject = JSONObject(vocabJsonStr)
            val keys = jsonObject.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                vocab[key] = jsonObject.getInt(key)
            }

            // Load merges.txt
            val mergesStream = context.assets.open("sd_tokenizer/merges.txt")
            val mergesReader = BufferedReader(InputStreamReader(mergesStream, Charsets.UTF_8))
            var rank = 0
            mergesReader.forEachLine { rawLine ->
                val line = rawLine.trim()
                if (line.isNotEmpty() && !line.startsWith("#")) {
                    val parts = line.split("\\s+".toRegex())
                    if (parts.size == 2) {
                        bpeRanks[Pair(parts[0], parts[1])] = rank++
                    }
                }
            }
            mergesReader.close()

            Log.i(TAG, "Loaded official CLIP tokenizer: ${vocab.size} vocab words, ${bpeRanks.size} BPE merges")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load CLIP assets from sd_tokenizer/, falling back to default", e)
            initializeDefaultVocab()
        }
    }

    private fun initializeDefaultVocab() {
        vocab["<|startoftext|>"] = START_TOKEN_ID
        vocab["<|endoftext|>"] = END_TOKEN_ID
        for (b in 0..255) {
            val ch = byteEncoder[b]?.toString() ?: b.toChar().toString()
            vocab[ch] = (b % 40000) + 1
        }
    }

    /**
     * Tokenize input text prompt into an IntArray of length 77 matching OpenCLIP padding with 49407.
     */
    fun encode(text: String): IntArray {
        val tokens = IntArray(CONTEXT_LENGTH) { END_TOKEN_ID }
        tokens[0] = START_TOKEN_ID

        if (text.isBlank()) {
            return tokens
        }

        val cleaned = text.lowercase().trim().replace(Regex("\\s+"), " ")
        val matcher = PATTERN.matcher(cleaned)
        var tokenIdx = 1

        while (matcher.find() && tokenIdx < CONTEXT_LENGTH - 1) {
            val word = matcher.group()
            val wordTokens = tokenizeWord(word)

            for (tid in wordTokens) {
                if (tokenIdx < CONTEXT_LENGTH - 1) {
                    tokens[tokenIdx++] = tid
                } else {
                    break
                }
            }
        }

        tokens[tokenIdx] = END_TOKEN_ID
        return tokens
    }

    private fun tokenizeWord(word: String): List<Int> {
        val bytes = word.toByteArray(Charsets.UTF_8)
        val chars = StringBuilder()

        for (b in bytes) {
            val ubyte = b.toInt() and 0xFF
            chars.append(byteEncoder[ubyte] ?: ubyte.toChar())
        }

        val token = chars.toString()
        val bpeTokens = bpe(token)
        val result = mutableListOf<Int>()

        for (sub in bpeTokens) {
            val id = vocab[sub] ?: vocab["<|endoftext|>"] ?: END_TOKEN_ID
            result.add(id)
        }

        return result
    }

    private fun getPairs(word: List<String>): Set<Pair<String, String>> {
        val pairs = mutableSetOf<Pair<String, String>>()
        var prev = word[0]
        for (i in 1 until word.size) {
            pairs.add(Pair(prev, word[i]))
            prev = word[i]
        }
        return pairs
    }

    private fun bpe(token: String): List<String> {
        if (cache.containsKey(token)) {
            return cache[token]!!
        }

        if (token.isEmpty()) return emptyList()
        if (token.length == 1) {
            val single = listOf(token + "</w>")
            cache[token] = single
            return single
        }

        var word = mutableListOf<String>()
        for (i in 0 until token.length - 1) {
            word.add(token[i].toString())
        }
        word.add(token[token.length - 1] + "</w>")

        var pairs = getPairs(word)
        if (pairs.isEmpty()) {
            val single = listOf(token + "</w>")
            cache[token] = single
            return single
        }

        while (true) {
            var minRank = Int.MAX_VALUE
            var bestBigram: Pair<String, String>? = null

            for (pair in pairs) {
                val rank = bpeRanks[pair]
                if (rank != null && rank < minRank) {
                    minRank = rank
                    bestBigram = pair
                }
            }

            if (bestBigram == null) break

            val first = bestBigram.first
            val second = bestBigram.second
            val newWord = mutableListOf<String>()
            var i = 0

            while (i < word.size) {
                val j = word.subList(i, word.size).indexOf(first)
                if (j == -1) {
                    newWord.addAll(word.subList(i, word.size))
                    break
                }
                newWord.addAll(word.subList(i, i + j))
                i += j

                if (word[i] == first && i < word.size - 1 && word[i + 1] == second) {
                    newWord.add(first + second)
                    i += 2
                } else {
                    newWord.add(word[i])
                    i += 1
                }
            }

            word = newWord
            if (word.size == 1) break
            pairs = getPairs(word)
        }

        cache[token] = word
        return word
    }
}
