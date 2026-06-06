package com.aimindmesh.mobile.litert.cache

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import android.util.Base64

private const val TAG = "ConvPersistenceMgr"

class ConversationPersistenceManager(private val context: Context) {

    private val cacheDir = File(context.filesDir, "litert_cache")

    init {
        if (!cacheDir.exists()) {
            cacheDir.mkdirs()
        }
    }

    /**
     * Serializes a list of LiteRT Messages to a JSON file.
     * Bug #4 Fix: The role (USER/MODEL) is now saved alongside message contents.
     * Previously all messages were serialized without role, causing them to be
     * restored as USER messages — corrupting the conversation history.
     */
    fun saveConversation(conversationId: String, messages: List<Message>): Boolean {
        return try {
            val root = JSONObject()
            val messagesArray = JSONArray()

            for (msg in messages) {
                val msgObj = JSONObject()
                val contentsArray = JSONArray()

                // Save the role so we can restore USER vs MODEL correctly on load
                msgObj.put("role", msg.role.name) // "USER", "MODEL", "SYSTEM", "TOOL"

                // LiteRT Message has contents (Contents object) which has contents (List<Content>)
                val contents = msg.contents.contents
                for (content in contents) {
                    val contentObj = JSONObject()
                    when (content) {
                        is Content.Text -> {
                            contentObj.put("type", "text")
                            contentObj.put("value", content.text)
                        }
                        is Content.ImageBytes -> {
                            contentObj.put("type", "image")
                            val base64 = Base64.encodeToString(content.bytes, Base64.NO_WRAP)
                            contentObj.put("value", base64)
                        }
                        is Content.AudioBytes -> {
                            contentObj.put("type", "audio")
                            val base64 = Base64.encodeToString(content.bytes, Base64.NO_WRAP)
                            contentObj.put("value", base64)
                        }
                        else -> {
                            // AudioFile, ImageFile, ToolResponse not supported for persistence yet
                        }
                    }
                    contentsArray.put(contentObj)
                }
                msgObj.put("contents", contentsArray)
                messagesArray.put(msgObj)
            }

            root.put("messages", messagesArray)
            root.put("updatedAt", System.currentTimeMillis())

            val file = File(cacheDir, "conv_$conversationId.json")
            file.writeText(root.toString())
            Log.i(TAG, "Conversation $conversationId saved to ${file.absolutePath} (${messages.size} messages)")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to save conversation $conversationId", e)
            false
        }
    }

    /**
     * Loads a conversation from a JSON file and returns a list of LiteRT Messages.
     * Bug #4 Fix: Uses Message.user() or Message.model() based on the saved role.
     * Old files without a "role" field default to USER for backward compatibility.
     */
    fun loadConversation(conversationId: String): List<Message>? {
        return try {
            val file = File(cacheDir, "conv_$conversationId.json")
            if (!file.exists()) return null

            val json = JSONObject(file.readText())
            val messagesArray = json.getJSONArray("messages")
            val messages = mutableListOf<Message>()

            for (i in 0 until messagesArray.length()) {
                val msgObj = messagesArray.getJSONObject(i)
                val contentsArray = msgObj.getJSONArray("contents")
                val contentsList = mutableListOf<Content>()
                // Default to USER for backward compat with old cache files without "role"
                val roleStr = msgObj.optString("role", "USER")

                for (j in 0 until contentsArray.length()) {
                    val contentObj = contentsArray.getJSONObject(j)
                    val type = contentObj.getString("type")
                    val value = contentObj.getString("value")

                    when (type) {
                        "text" -> contentsList.add(Content.Text(value))
                        "image" -> {
                            val bytes = Base64.decode(value, Base64.DEFAULT)
                            contentsList.add(Content.ImageBytes(bytes))
                        }
                        "audio" -> {
                            val bytes = Base64.decode(value, Base64.DEFAULT)
                            contentsList.add(Content.AudioBytes(bytes))
                        }
                    }
                }

                // Reconstruct message with the correct role
                val c = com.google.ai.edge.litertlm.Message.of(contentsList).contents
                val message = when (roleStr) {
                    "MODEL" -> Message.model(c)
                    "SYSTEM" -> Message.system(c)
                    else -> Message.user(c) // USER and unknown roles
                }
                messages.add(message)
            }
            Log.i(TAG, "Conversation $conversationId loaded from disk (${messages.size} messages)")
            messages
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load conversation $conversationId", e)
            null
        }
    }

    fun invalidateCache(conversationId: String) {
        val file = File(cacheDir, "conv_$conversationId.json")
        if (file.exists()) {
            file.delete()
            Log.i(TAG, "Cache invalidated for $conversationId")
        }
    }
}
