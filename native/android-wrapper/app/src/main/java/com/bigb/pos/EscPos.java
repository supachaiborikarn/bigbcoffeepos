package com.bigb.pos;

import java.io.ByteArrayOutputStream;

/**
 * Turns a rendered receipt (ARGB pixels) into ESC/POS raster commands.
 *
 * Printing a picture instead of text means Thai vowels and tone marks come out exactly as the
 * web receipt shows them, whatever code pages the printer has. Pure Java (no android.*) so it
 * can be checked on a desktop JVM.
 */
public final class EscPos {
    private EscPos() {}

    /** Printable dots across the head: 58 mm paper → 384 (48 mm × 8 dots/mm), 80 mm → 576. */
    public static int dotsForPaper(int widthMm) {
        return widthMm >= 80 ? 576 : 384;
    }

    /** Rows per GS v 0 block. Small blocks keep cheap printers' input buffers from overflowing. */
    static final int BAND_ROWS = 96;
    /** Pixels darker than this (0–255 luminance) print black. */
    static final int THRESHOLD = 170;

    /**
     * One receipt: initialise, raster image, feed past the tear bar, partial cut
     * (printers without a cutter ignore the cut).
     */
    public static byte[] receipt(int[] argb, int width, int height) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(width * height / 8 + 64);
        out.write(0x1B); out.write(0x40);               // ESC @  initialise
        raster(out, argb, width, height);
        out.write(0x1B); out.write(0x64); out.write(4); // ESC d 4  feed 4 lines
        out.write(0x1D); out.write(0x56); out.write(66); out.write(0); // GS V 66 0  feed + partial cut
        return out.toByteArray();
    }

    static void raster(ByteArrayOutputStream out, int[] argb, int width, int height) {
        int lastInk = lastRowWithInk(argb, width, height);
        int rows = Math.max(1, lastInk + 1);
        int bytesPerRow = (width + 7) / 8;
        for (int top = 0; top < rows; top += BAND_ROWS) {
            int bandRows = Math.min(BAND_ROWS, rows - top);
            // GS v 0 m xL xH yL yH d1...dk
            out.write(0x1D); out.write(0x76); out.write(0x30); out.write(0);
            out.write(bytesPerRow & 0xFF); out.write((bytesPerRow >> 8) & 0xFF);
            out.write(bandRows & 0xFF); out.write((bandRows >> 8) & 0xFF);
            for (int y = top; y < top + bandRows; y++) {
                int rowStart = y * width;
                for (int bx = 0; bx < bytesPerRow; bx++) {
                    int b = 0;
                    for (int bit = 0; bit < 8; bit++) {
                        int x = bx * 8 + bit;
                        if (x < width && isInk(argb[rowStart + x])) b |= 0x80 >> bit;
                    }
                    out.write(b);
                }
            }
        }
    }

    static boolean isInk(int pixel) {
        int a = (pixel >>> 24) & 0xFF;
        if (a < 128) return false;
        int r = (pixel >> 16) & 0xFF, g = (pixel >> 8) & 0xFF, bl = pixel & 0xFF;
        int luminance = (r * 299 + g * 587 + bl * 114) / 1000;
        return luminance < THRESHOLD;
    }

    /** Skip the blank tail the web view leaves under the slip so no paper is wasted. */
    static int lastRowWithInk(int[] argb, int width, int height) {
        for (int y = height - 1; y >= 0; y--) {
            int rowStart = y * width;
            for (int x = 0; x < width; x++) if (isInk(argb[rowStart + x])) return y;
        }
        return -1;
    }
}
