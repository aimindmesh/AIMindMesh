package com.aimindmesh.mobile.litert

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.google.ai.edge.litertlm.Content
import java.io.ByteArrayOutputStream

private const val TAG = "LiteRTInputs"

/** Request parsing shared by the LiteRT generate methods (images, audio paths, tool prompt). */
internal object LiteRTInputs {

    /** Decodes data URIs, raw base64, content:// URIs and file paths; undecodable entries are skipped. */
    fun decodeImages(imagesArray: JSArray?, context: Context): List<Bitmap> {
        val bitmaps = mutableListOf<Bitmap>()
        if (imagesArray == null) return bitmaps
        for (i in 0 until imagesArray.length()) {
            try {
                val imageData = imagesArray.getString(i)
                val bitmap = when {
                    imageData.startsWith("data:image") -> {
                        val bytes = Base64.decode(imageData.substringAfter(","), Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }
                    // Pure base64 string (JPEG starts with /9j/, PNG with iVBOR)
                    imageData.startsWith("/9j/") || imageData.startsWith("iVBOR") || imageData.length > 1000 -> {
                        val bytes = Base64.decode(imageData, Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    }
                    imageData.startsWith("content://") -> {
                        context.contentResolver.openInputStream(Uri.parse(imageData))?.use { BitmapFactory.decodeStream(it) }
                    }
                    else -> {
                        val cleanPath = if (imageData.startsWith("file://")) imageData.substring(7) else imageData
                        BitmapFactory.decodeFile(cleanPath)
                    }
                }
                if (bitmap != null) {
                    bitmaps.add(bitmap)
                } else {
                    Log.e(TAG, "Failed to decode bitmap $i: null result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading image $i: ${e.message}", e)
            }
        }
        return bitmaps
    }

    fun stringList(array: JSArray?): List<String> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { array.optString(it, null) }
    }

    /** Images first, then audio, then text (the order LiteRT-LM multimodal prompts expect). */
    fun buildContents(bitmaps: List<Bitmap>, audio: List<ByteArray>, text: String): List<Content> {
        val contents = mutableListOf<Content>()
        bitmaps.forEach { bitmap ->
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            contents.add(Content.ImageBytes(stream.toByteArray()))
        }
        audio.forEach { contents.add(Content.AudioBytes(it)) }
        if (text.trim().isNotEmpty()) {
            contents.add(Content.Text(text))
        }
        return contents
    }

    fun withTools(prompt: String, toolDefinitions: String): String =
        "$prompt\n\nYou have access to the following tools. To use a tool, output:\n<tool>function_name({\"key\": \"value\"})</tool>\n\nAvailable tools:\n$toolDefinitions"

    /** Renders registered tools ({name, description, parameters JSON schema}) for the prompt. */
    fun formatTools(toolsArray: JSArray): String {
        val sb = StringBuilder()
        for (i in 0 until toolsArray.length()) {
            val tool = toolsArray.optJSONObject(i) ?: continue
            if (sb.isNotEmpty()) sb.append("\n")
            sb.append("function: ").append(tool.optString("name", "tool_$i")).append('\n')
                .append("description: ").append(tool.optString("description", "No description")).append('\n')
                .append("parameters: ").append(tool.optString("parameters", "{}")).append('\n')
        }
        return sb.toString()
    }
}
