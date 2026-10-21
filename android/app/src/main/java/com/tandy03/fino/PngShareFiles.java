package com.tandy03.fino;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/** PNG-only validation/cache rules; no Android, bitmap, financial or network dependencies. */
final class PngShareFiles {
    static final int MAX_BYTES = 5 * 1024 * 1024;
    static final int MAX_BASE64 = ((MAX_BYTES + 2) / 3) * 4;
    static final int SIDE = 1080;
    static final String DIRECTORY = "portfolio-share";
    static final long RETENTION_MS = 60 * 60 * 1000L;
    static final int MAX_FILES = 8;
    static final long MAX_CACHE_BYTES = 20 * 1024 * 1024L;
    private static final byte[] SIGNATURE = { (byte)137, 80, 78, 71, 13, 10, 26, 10 };

    static String filename(String name) {
        if (name == null || !name.matches("fino-portfolio-\\d{4}-\\d{2}-\\d{2}\\.png")) throw new IllegalArgumentException();
        String date = name.substring(15, 25);
        SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        parser.setLenient(false);
        ParsePosition position = new ParsePosition(0);
        if (parser.parse(date, position) == null || position.getIndex() != date.length()) throw new IllegalArgumentException();
        return name;
    }

    static int base64Length(String encoded) {
        if (encoded == null || encoded.length() == 0 || encoded.length() > MAX_BASE64 || encoded.length() % 4 != 0) throw new IllegalArgumentException();
        int padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        for (int i = 0; i < encoded.length() - padding; i++) {
            char c = encoded.charAt(i);
            if (!(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/')) throw new IllegalArgumentException();
        }
        int length = encoded.length() / 4 * 3 - padding;
        if (length <= 0 || length > MAX_BYTES) throw new IllegalArgumentException();
        return length;
    }

    private static int integer(byte[] bytes, int offset) {
        return (bytes[offset] & 255) << 24 | (bytes[offset + 1] & 255) << 16 | (bytes[offset + 2] & 255) << 8 | bytes[offset + 3] & 255;
    }

    static void validate(byte[] bytes) {
        if (bytes == null || bytes.length < 57 || bytes.length > MAX_BYTES) throw new IllegalArgumentException();
        for (int i = 0; i < SIGNATURE.length; i++) if (bytes[i] != SIGNATURE[i]) throw new IllegalArgumentException();
        Inflater inflater = new Inflater();
        byte[] buffer = new byte[8192];
        int offset = 8, stride = 0, decoded = 0;
        boolean header = false, data = false, dataEnded = false, end = false;
        try {
            while (offset + 12 <= bytes.length) {
                int length = integer(bytes, offset), type = integer(bytes, offset + 4);
                if (length < 0 || length > bytes.length - offset - 12) throw new IllegalArgumentException();
                CRC32 crc = new CRC32(); crc.update(bytes, offset + 4, length + 4);
                if ((int)crc.getValue() != integer(bytes, offset + 8 + length)) throw new IllegalArgumentException();
                if (!header) {
                    // Canvas exports non-interlaced 8-bit RGB/RGBA, not arbitrary image imports.
                    if (type != 0x49484452 || length != 13 || integer(bytes, offset + 8) != SIDE || integer(bytes, offset + 12) != SIDE
                        || bytes[offset + 16] != 8 || (bytes[offset + 17] != 2 && bytes[offset + 17] != 6)
                        || bytes[offset + 18] != 0 || bytes[offset + 19] != 0 || bytes[offset + 20] != 0) throw new IllegalArgumentException();
                    stride = SIDE * (bytes[offset + 17] == 6 ? 4 : 3) + 1; header = true;
                } else if (type == 0x49484452) throw new IllegalArgumentException();
                else if (type == 0x49444154) {
                    if (dataEnded || inflater.finished() && length != 0) throw new IllegalArgumentException();
                    data = true;
                    if (length != 0) inflater.setInput(bytes, offset + 8, length);
                    while (!inflater.needsInput() && !inflater.finished()) {
                        int count = inflater.inflate(buffer);
                        if (count == 0) { if (inflater.needsInput() || inflater.finished()) break; throw new IllegalArgumentException(); }
                        if (decoded + count > stride * SIDE) throw new IllegalArgumentException();
                        for (int i = 0; i < count; i++) if ((decoded + i) % stride == 0 && (buffer[i] & 255) > 4) throw new IllegalArgumentException();
                        decoded += count;
                    }
                    if (inflater.finished() && inflater.getRemaining() != 0) throw new IllegalArgumentException();
                } else {
                    if (data) dataEnded = true;
                    if (type == 0x49454e44) {
                        if (length != 0 || offset + 12 != bytes.length) throw new IllegalArgumentException();
                        end = true; break;
                    }
                    // Unknown critical chunks cannot be interpreted safely. PLTE is optional for RGB.
                    if ((bytes[offset + 4] & 32) == 0 && type != 0x504c5445) throw new IllegalArgumentException();
                }
                offset += length + 12;
            }
            if (!end || !data || !inflater.finished() || decoded != stride * SIDE) throw new IllegalArgumentException();
        } catch (DataFormatException error) { throw new IllegalArgumentException(); }
        finally { inflater.end(); java.util.Arrays.fill(buffer, (byte)0); }
    }

    interface OutputFactory { OutputStream open() throws IOException; }

    /** Success means write, flush AND close completed; never owns the caller's byte buffer. */
    static void write(byte[] bytes, OutputFactory output, BooleanSupplier interrupted) throws IOException {
        if (bytes == null || bytes.length == 0 || bytes.length > MAX_BYTES) throw new IOException();
        if (interrupted.getAsBoolean()) throw new InterruptedIOException();
        try (OutputStream stream = output.open()) {
            if (stream == null) throw new IOException();
            for (int offset = 0; offset < bytes.length; offset += 8192) {
                if (interrupted.getAsBoolean()) throw new InterruptedIOException();
                stream.write(bytes, offset, Math.min(8192, bytes.length - offset));
            }
            stream.flush();
        }
        if (interrupted.getAsBoolean()) throw new InterruptedIOException();
    }

    private static File directory(File cache) throws IOException {
        File root = cache.getCanonicalFile(), directory = new File(root, DIRECTORY);
        if (!directory.getCanonicalFile().equals(directory.getAbsoluteFile())) throw new IOException();
        if (!directory.exists() && !directory.mkdir()) throw new IOException();
        if (!directory.isDirectory()) throw new IOException();
        return directory;
    }

    static synchronized void cleanup(File cache, long now) throws IOException {
        File directory = directory(cache);
        File[] files = directory.listFiles();
        if (files == null) throw new IOException();
        for (File file : files) {
            if (!file.getCanonicalFile().equals(file.getAbsoluteFile()) || !file.isFile()) throw new IOException();
            if (now - file.lastModified() >= RETENTION_MS && !file.delete()) throw new IOException();
        }
    }

    static synchronized File create(File cache, byte[] bytes, String name, long now) throws IOException {
        filename(name);
        cleanup(cache, now);
        File directory = directory(cache), file = new File(directory, name.substring(0, name.length() - 4) + "-" + UUID.randomUUID() + ".png");
        File[] files = directory.listFiles();
        if (files == null) throw new IOException();
        long size = bytes.length;
        for (File existing : files) size += existing.length();
        // Never evict a recent file which a recipient may still be reading.
        if (files.length >= MAX_FILES || size > MAX_CACHE_BYTES) throw new CacheFullException();
        if (!file.createNewFile()) throw new IOException();
        try {
            try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); stream.flush(); }
            if (!file.setLastModified(now)) throw new IOException();
            return file;
        } catch (IOException error) { file.delete(); throw error; }
    }
    static final class CacheFullException extends IOException { private static final long serialVersionUID = 1L; }
}
