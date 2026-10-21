package com.tandy03.fino;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

/** Standalone synthetic tests: javac/java only, no Android build or real user files. */
public final class PngShareFilesTest {
    private static final String NAME = "fino-portfolio-2026-10-21.png";
    private static int checks;
    private interface IOAction { void run() throws IOException; }
    private static void ioFailure(IOAction action) throws Exception {
        try { action.run(); throw new AssertionError("Failed IO reported success"); } catch (IOException expected) { checks++; }
    }
    private static final class Probe extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean closed, flushed, failWrite, failFlush, failClose;
        Runnable afterWrite = () -> {}, afterClose = () -> {};
        @Override public void write(int value) throws IOException { write(new byte[] {(byte)value},0,1); }
        @Override public void write(byte[] value, int offset, int length) throws IOException {
            if (failWrite) throw new IOException("synthetic write failure");
            bytes.write(value,offset,length); afterWrite.run();
        }
        @Override public void flush() throws IOException { if (failFlush) throw new IOException("synthetic flush failure"); flushed = true; }
        @Override public void close() throws IOException { closed = true; afterClose.run(); if (failClose) throw new IOException("synthetic close failure"); }
    }
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("PNG invariant failed at check " + checks); }
    private static void invalid(Runnable action) { try { action.run(); throw new AssertionError("Invalid PNG accepted"); } catch (IllegalArgumentException expected) { checks++; } }
    private static byte[] chunk(String type, byte[] bytes) throws Exception {
        ByteArrayOutputStream raw = new ByteArrayOutputStream(); DataOutputStream out = new DataOutputStream(raw);
        byte[] tag = type.getBytes("US-ASCII"); CRC32 crc = new CRC32(); crc.update(tag); crc.update(bytes);
        out.writeInt(bytes.length); out.write(tag); out.write(bytes); out.writeInt((int)crc.getValue()); return raw.toByteArray();
    }
    private static byte[] png(int side, int color, int filter, int extra, boolean split) throws Exception {
        ByteArrayOutputStream raw = new ByteArrayOutputStream(); DataOutputStream out = new DataOutputStream(raw);
        out.write(new byte[] {(byte)137,80,78,71,13,10,26,10});
        ByteArrayOutputStream header = new ByteArrayOutputStream(); DataOutputStream h = new DataOutputStream(header);
        h.writeInt(side); h.writeInt(side); h.write(new byte[] {8,(byte)color,0,0,0}); out.write(chunk("IHDR",header.toByteArray()));
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        try (DeflaterOutputStream zip = new DeflaterOutputStream(data)) {
            byte[] row = new byte[side * (color == 6 ? 4 : 3) + 1]; row[0] = (byte)filter;
            for (int i = 0; i < side + extra; i++) zip.write(row);
        }
        byte[] compressed = data.toByteArray();
        if (split) for (byte value : compressed) out.write(chunk("IDAT",new byte[] {value}));
        else out.write(chunk("IDAT",compressed));
        out.write(chunk("IEND",new byte[0])); return raw.toByteArray();
    }
    public static void main(String[] args) throws Exception {
        byte[] good = png(1080,6,0,0,false);
        PngShareFiles.validate(good); checks++;
        PngShareFiles.validate(png(1080,2,4,0,true)); checks++;
        check(PngShareFiles.base64Length(Base64.getEncoder().encodeToString(good)) == good.length);
        check(PngShareFiles.filename(NAME).equals(NAME));
        for (String name : new String[] {"../"+NAME,"fino-portfolio-2026-02-31.png","fino-portfolio-0000-01-01.png","private-name.png","fino-portfolio-2026-10-21.png/other"}) invalid(() -> PngShareFiles.filename(name));
        for (String text : new String[] {"", "abc", "====", "ab c", "ab=c", "AA==\n", "A".repeat(PngShareFiles.MAX_BASE64 + 4)}) invalid(() -> PngShareFiles.base64Length(text));
        invalid(() -> PngShareFiles.base64Length(Base64.getEncoder().encodeToString(new byte[PngShareFiles.MAX_BYTES + 1])));
        invalid(() -> PngShareFiles.validate(null)); invalid(() -> PngShareFiles.validate(new byte[0]));
        invalid(() -> PngShareFiles.validate(new byte[PngShareFiles.MAX_BYTES + 1]));
        byte[] signature = good.clone(); signature[0] = 0; invalid(() -> PngShareFiles.validate(signature));
        byte[] crc = good.clone(); crc[29] ^= 1; invalid(() -> PngShareFiles.validate(crc));
        invalid(() -> PngShareFiles.validate(Arrays.copyOf(good,good.length - 12)));
        invalid(() -> PngShareFiles.validate(Arrays.copyOf(good,good.length + 1)));
        byte[] wrongSize = png(10,6,0,0,false); invalid(() -> PngShareFiles.validate(wrongSize));
        byte[] bomb = png(1080,6,0,1,false); invalid(() -> PngShareFiles.validate(bomb));
        byte[] shortData = png(1080,6,0,-1,false); invalid(() -> PngShareFiles.validate(shortData));
        byte[] badFilter = png(1080,6,5,0,false); invalid(() -> PngShareFiles.validate(badFilter));
        // The same writer is used after SAF selection. A close failure is a
        // failed save, even when all PNG bytes reached the provider.
        Probe output = new Probe();
        PngShareFiles.write(good, () -> output, () -> false);
        check(output.closed && output.flushed); check(Arrays.equals(good,output.bytes.toByteArray()));
        ioFailure(() -> PngShareFiles.write(good, () -> { throw new IOException("synthetic provider unavailable"); }, () -> false));
        ioFailure(() -> PngShareFiles.write(good, () -> null, () -> false));
        for (String stage : new String[] {"write","flush","close"}) {
            Probe failed = new Probe(); failed.failWrite = stage.equals("write"); failed.failFlush = stage.equals("flush"); failed.failClose = stage.equals("close");
            ioFailure(() -> PngShareFiles.write(good, () -> failed, () -> false)); check(failed.closed);
        }
        java.util.concurrent.atomic.AtomicBoolean interrupted = new java.util.concurrent.atomic.AtomicBoolean(true);
        ioFailure(() -> PngShareFiles.write(good, () -> { throw new AssertionError("Cancelled save opened provider"); }, interrupted::get));
        interrupted.set(false); Probe cancelled = new Probe(); cancelled.afterWrite = () -> interrupted.set(true);
        ioFailure(() -> PngShareFiles.write(new byte[20001], () -> cancelled, interrupted::get)); check(cancelled.closed); check(cancelled.bytes.size() == 8192);
        interrupted.set(false); Probe closedWhileInterrupted = new Probe(); closedWhileInterrupted.afterClose = () -> interrupted.set(true);
        ioFailure(() -> PngShareFiles.write(good, () -> closedWhileInterrupted, interrupted::get)); check(closedWhileInterrupted.closed);
        check(Arrays.equals(good,output.bytes.toByteArray()));
        File cache = new File(args[0]); check(cache.mkdir()); long now = System.currentTimeMillis();
        List<File> created = new ArrayList<>();
        for (int i = 0; i < PngShareFiles.MAX_FILES; i++) created.add(PngShareFiles.create(cache,good,NAME,now));
        check(new HashSet<>(created).size() == PngShareFiles.MAX_FILES);
        try { PngShareFiles.create(cache,good,NAME,now); throw new AssertionError("Unbounded cache"); } catch (PngShareFiles.CacheFullException expected) { checks++; }
        PngShareFiles.cleanup(cache,now + PngShareFiles.RETENTION_MS - 1);
        for (File file : created) check(file.exists());
        PngShareFiles.cleanup(cache,now + PngShareFiles.RETENTION_MS);
        for (File file : created) check(!file.exists());
        File oversized = PngShareFiles.create(cache,good,NAME,now);
        try (RandomAccessFile file = new RandomAccessFile(oversized,"rw")) { file.setLength(PngShareFiles.MAX_CACHE_BYTES); }
        try { PngShareFiles.create(cache,good,NAME,now); throw new AssertionError("Unbounded bytes"); } catch (PngShareFiles.CacheFullException expected) { checks++; }
        check(oversized.exists()); check(oversized.delete());
        ExecutorService pool = Executors.newFixedThreadPool(4); List<Future<Boolean>> results = new ArrayList<>();
        for (int i = 0; i < 12; i++) results.add(pool.submit(() -> { try { PngShareFiles.create(cache,good,NAME,now); return true; } catch (PngShareFiles.CacheFullException expected) { return false; } }));
        int successes = 0; for (Future<Boolean> result : results) if (result.get()) successes++;
        pool.shutdown(); check(successes == PngShareFiles.MAX_FILES);
        PngShareFiles.cleanup(cache,now + PngShareFiles.RETENTION_MS); check(new File(cache,PngShareFiles.DIRECTORY).list().length == 0);
        System.out.println("PNG validation/cache: " + checks + " synthetic checks passed.");
    }
}
