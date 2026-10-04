package com.aimindmesh.mobile.utils;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class ModelAssetManagerTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private static ByteArrayInputStream zip(String... namesAndContents) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(bytes)) {
            for (int i = 0; i < namesAndContents.length; i += 2) {
                zos.putNextEntry(new ZipEntry(namesAndContents[i]));
                zos.write(namesAndContents[i + 1].getBytes());
                zos.closeEntry();
            }
        }
        return new ByteArrayInputStream(bytes.toByteArray());
    }

    @Test
    public void unpacksWithoutTheZipRootFolderAndMarksComplete() throws IOException {
        File vosk = tmp.newFolder("vosk-models");
        ModelAssetManager.unpackVoskModel(zip("model-a/am/final.mdl", "x", "model-a/conf/model.conf", "y"), vosk, "model-a");
        assertTrue(new File(vosk, "model-a/am/final.mdl").exists());
        assertTrue(new File(vosk, "model-a/" + ModelAssetManager.COMPLETE_MARKER).exists());
        assertFalse(new File(vosk, "model-a.tmp").exists());
    }

    @Test
    public void keepsAModelTheUserAlreadyHas() throws IOException {
        File vosk = tmp.newFolder("vosk-models");
        File existing = new File(vosk, "model-a/am/final.mdl");
        existing.getParentFile().mkdirs();
        Files.write(existing.toPath(), "downloaded".getBytes());

        ModelAssetManager.unpackVoskModel(zip("model-a/am/final.mdl", "bundled"), vosk, "model-a");

        assertEquals("downloaded", new String(Files.readAllBytes(existing.toPath())));
        assertTrue(new File(vosk, "model-a/" + ModelAssetManager.COMPLETE_MARKER).exists());
    }

    @Test
    public void refusesEntriesOutsideTheModelFolder() throws IOException {
        File vosk = tmp.newFolder("vosk-models");
        try {
            ModelAssetManager.unpackVoskModel(zip("model-a/../../evil.txt", "x"), vosk, "model-a");
            fail("zip slip not detected");
        } catch (SecurityException expected) {
            // the partial unpack is cleaned up
        }
        assertFalse(new File(tmp.getRoot(), "evil.txt").exists());
        assertFalse(new File(vosk, "model-a.tmp").exists());
        assertFalse(new File(vosk, "model-a").exists());
    }

    @Test
    public void copiesAFileModelOnlyWhenMissing() throws IOException {
        File dest = new File(tmp.getRoot(), "models/ecapa_tdnn.onnx");
        ModelAssetManager.copyIfMissing(new ByteArrayInputStream(new byte[] { 1, 2, 3 }), dest);
        assertArrayEquals(new byte[] { 1, 2, 3 }, Files.readAllBytes(dest.toPath()));

        // Another model the user chose stays
        ModelAssetManager.copyIfMissing(new ByteArrayInputStream(new byte[] { 9 }), dest);
        assertArrayEquals(new byte[] { 1, 2, 3 }, Files.readAllBytes(dest.toPath()));
        assertFalse(new File(dest.getPath() + ".tmp").exists());
    }
}
