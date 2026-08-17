package com.aimindmesh.mobile.sd

import android.content.Context
import android.net.Uri
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

object SDFileUtils {
    private const val TAG = "SDFileUtils"

    /**
     * Unzips an InputStream into a target directory with path traversal protection
     * and automatic single-directory flattening.
     */
    fun extractZipStream(inputStream: InputStream, targetDir: File): Boolean {
        return try {
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }

            Log.i(TAG, "Extracting Stable Diffusion bundle to: ${targetDir.absolutePath}")

            ZipInputStream(BufferedInputStream(inputStream)).use { zis ->
                val buffer = ByteArray(128 * 1024)
                val canonicalDest = targetDir.canonicalPath
                var entry: ZipEntry? = zis.nextEntry

                while (entry != null) {
                    val entryName = entry.name
                    // Skip OS junk and macOS metadata
                    if (entryName.startsWith("__MACOSX/") || entryName.contains("/__MACOSX/") || entryName.endsWith(".DS_Store")) {
                        zis.closeEntry()
                        entry = zis.nextEntry
                        continue
                    }

                    val newFile = File(targetDir, entryName)
                    val canonicalFile = newFile.canonicalPath
                    if (!canonicalFile.startsWith(canonicalDest + File.separator) && canonicalFile != canonicalDest) {
                        throw SecurityException("Zip entry is outside target directory: ${entry.name}")
                    }

                    if (entry.isDirectory) {
                        newFile.mkdirs()
                    } else {
                        val parent = newFile.parentFile
                        if (parent != null && !parent.exists()) {
                            parent.mkdirs()
                        }
                        FileOutputStream(newFile).use { fos ->
                            var len: Int
                            while (zis.read(buffer).also { len = it } > 0) {
                                fos.write(buffer, 0, len)
                            }
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }

            // Flatten nested single top-level directory if present
            flattenNestedDirectory(targetDir)

            Log.i(TAG, "SD bundle extracted successfully into: ${targetDir.absolutePath}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to extract Stable Diffusion ZIP", e)
            false
        }
    }

    /**
     * If the target directory contains only a single subdirectory,
     * move all files from the subdirectory to the target directory.
     */
    fun flattenNestedDirectory(targetDir: File) {
        if (!targetDir.exists() || !targetDir.isDirectory) return

        val allFiles = targetDir.listFiles() ?: return
        val validDirs = allFiles.filter { it.isDirectory && !it.name.startsWith(".") && it.name != "__MACOSX" }
        val validFiles = allFiles.filter { !it.name.startsWith(".") && it.name != "__MACOSX" }

        if (validDirs.size == 1 && validFiles.size == 1) {
            val innerDir = validDirs[0]
            val innerFiles = innerDir.listFiles()
            if (innerFiles != null) {
                for (f in innerFiles) {
                    val dest = File(targetDir, f.name)
                    if (dest.exists()) {
                        deleteRecursively(dest)
                    }
                    f.renameTo(dest)
                }
            }
            innerDir.delete()
        }
    }

    /**
     * Recursively deletes a file or directory.
     */
    fun deleteRecursively(fileOrDir: File?): Boolean {
        if (fileOrDir == null || !fileOrDir.exists()) return true
        if (fileOrDir.isDirectory) {
            val children = fileOrDir.listFiles()
            if (children != null) {
                for (child in children) {
                    deleteRecursively(child)
                }
            }
        }
        return fileOrDir.delete()
    }

    /**
     * Safely opens an InputStream from a content URI or file path.
     */
    fun openInputStream(context: Context, sourcePath: String): InputStream? {
        return try {
            val clean = sourcePath.removePrefix("file://")
            if (clean.startsWith("content://")) {
                context.contentResolver.openInputStream(Uri.parse(clean))
            } else {
                val f = File(clean)
                if (f.exists()) {
                    FileInputStream(f)
                } else {
                    context.contentResolver.openInputStream(Uri.parse(sourcePath))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error opening InputStream for $sourcePath", e)
            null
        }
    }

    /**
     * Checks if directory contains Stable Diffusion components.
     */
    fun isSDModelDirectory(dir: File): Boolean {
        if (!dir.exists() || !dir.isDirectory) return false
        val files = dir.listFiles() ?: return false
        return files.any { f ->
            val name = f.name.lowercase()
            name.contains("unet") || name.contains("vae") || name.contains("text_encoder") ||
                name.endsWith(".onnx") || name.endsWith(".bin") || name.endsWith(".raw") || name == "metadata.json"
        }
    }

    /**
     * Finds the actual directory holding SD weights (unet/vae/encoder/etc.) even if nested.
     */
    fun findSDModelDirectory(baseDir: File): File? {
        if (!baseDir.exists()) return null
        if (baseDir.isFile) return baseDir.parentFile

        if (isSDModelDirectory(baseDir)) return baseDir

        var found: File? = null
        baseDir.walkTopDown().maxDepth(3).forEach { file ->
            if (found == null && file.isDirectory && isSDModelDirectory(file)) {
                found = file
            }
        }
        return found ?: baseDir
    }
}
