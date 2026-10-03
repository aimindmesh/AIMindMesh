package com.aimindmesh.mobile.sd

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

/** Bitmap work around the fixed square canvas of the NPU graphs. */
internal object SDImageOps {
    /** Decoding stops at this long side: enough for a high-quality reduction to 512 */
    private const val DECODE_LONG_SIDE = 1024

    /** Reads a source image (data URL, base64, file path, content:// or Capacitor web path), upright. */
    fun decodeSource(context: Context, source: String): Bitmap {
        val bytes = try {
            readSourceBytes(context, source.trim())
        } catch (e: Exception) {
            null
        } ?: throw IllegalArgumentException("Could not read the image to edit")

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("The image to edit is not a supported picture")
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= DECODE_LONG_SIDE) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            ?: throw IllegalArgumentException("The image to edit could not be decoded")
        return applyExifOrientation(bitmap, bytes)
    }

    private fun readSourceBytes(context: Context, source: String): ByteArray? {
        val capacitorFile = source.substringAfter("/_capacitor_file_", "")
        return when {
            source.startsWith("data:") || source.contains(";base64,") ->
                Base64.decode(source.substringAfter("base64,"), Base64.DEFAULT)
            source.startsWith("content://") ->
                context.contentResolver.openInputStream(Uri.parse(source))?.use { it.readBytes() }
            capacitorFile.isNotEmpty() -> File(Uri.decode(capacitorFile)).readBytes()
            source.startsWith("file://") -> File(Uri.decode(source.removePrefix("file://"))).readBytes()
            source.startsWith("/") -> File(source).readBytes()
            else -> Base64.decode(source, Base64.DEFAULT) // bare base64
        }
    }

    /** Camera photos are stored sideways with an EXIF rotation tag that BitmapFactory ignores. */
    private fun applyExifOrientation(bitmap: Bitmap, bytes: ByteArray): Bitmap {
        val orientation = try {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (e: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(-90f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    /** Downscale by successive halvings, then one filtered step: no aliasing from large photos. */
    fun scaleHighQuality(src: Bitmap, width: Int, height: Int): Bitmap {
        var current = src
        while (current.width / 2 >= width && current.height / 2 >= height) {
            current = Bitmap.createScaledBitmap(current, current.width / 2, current.height / 2, true)
        }
        return if (current.width == width && current.height == height) current
        else Bitmap.createScaledBitmap(current, width, height, true)
    }

    /**
     * The source fitted in the [size] square without distortion, margins mirrored; returns the RGB
     * bytes for the VAE encoder and where the picture sits, to crop the result back to its shape.
     */
    fun prepareForEditing(src: Bitmap, size: Int): Pair<ByteArray, PixelRect> {
        val rect = SDGeometry.fitInSquare(src.width, src.height, size)
        val scaled = scaleHighQuality(src, rect.width, rect.height)
        val pixels = IntArray(rect.width * rect.height)
        scaled.getPixels(pixels, 0, rect.width, 0, 0, rect.width, rect.height)
        return argbToRgb(SDGeometry.reflectPad(pixels, rect, size)) to rect
    }

    fun argbToRgb(pixels: IntArray): ByteArray {
        val rgb = ByteArray(pixels.size * 3)
        for (i in pixels.indices) {
            val px = pixels[i]
            rgb[i * 3] = (px shr 16 and 0xFF).toByte()
            rgb[i * 3 + 1] = (px shr 8 and 0xFF).toByte()
            rgb[i * 3 + 2] = (px and 0xFF).toByte()
        }
        return rgb
    }

    fun bitmapToRgb(bitmap: Bitmap): ByteArray {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return argbToRgb(pixels)
    }

    fun rgbToBitmap(rgb: ByteArray, width: Int, height: Int): Bitmap {
        val pixels = IntArray(width * height) { i ->
            (0xFF shl 24) or ((rgb[i * 3].toInt() and 0xFF) shl 16) or
                ((rgb[i * 3 + 1].toInt() and 0xFF) shl 8) or (rgb[i * 3 + 2].toInt() and 0xFF)
        }
        return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    }

    fun crop(src: Bitmap, rect: PixelRect): Bitmap =
        if (rect.x == 0 && rect.y == 0 && rect.width == src.width && rect.height == src.height) src
        else Bitmap.createBitmap(src, rect.x, rect.y, rect.width, rect.height)

    /**
     * Upscales the whole square first (Real-ESRGAN sees the full, undistorted picture), then crops
     * [rect] and brings it to [upscale] times its size. Without the model, plain filtering.
     */
    fun upscaleAndCrop(square: Bitmap, rect: PixelRect, upscale: Int, superResolve: (ByteArray) -> ByteArray?, srWidth: Int, srHeight: Int): Bitmap {
        val targetW = rect.width * upscale
        val targetH = rect.height * upscale
        if (upscale > 1 && srWidth > 0 && srHeight > 0) {
            val sr = superResolve(bitmapToRgb(square))
            if (sr != null && sr.size == srWidth * srHeight * 3) {
                val factor = srWidth / square.width
                val big = crop(rgbToBitmap(sr, srWidth, srHeight), rect.scaled(factor))
                return if (big.width == targetW && big.height == targetH) big
                else if (big.width > targetW) scaleHighQuality(big, targetW, targetH)
                else Bitmap.createScaledBitmap(big, targetW, targetH, true)
            }
        }
        val cropped = crop(square, rect)
        return if (upscale <= 1) cropped else Bitmap.createScaledBitmap(cropped, targetW, targetH, true)
    }

    /** PNG up to 1024 px; larger results as high-quality JPEG (a 2048 px PNG is ~8 MB of base64). */
    fun toDataUrl(bitmap: Bitmap): String {
        val jpeg = maxOf(bitmap.width, bitmap.height) > 1024
        val out = ByteArrayOutputStream()
        bitmap.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, if (jpeg) 95 else 100, out)
        val mime = if (jpeg) "image/jpeg" else "image/png"
        return "data:$mime;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
