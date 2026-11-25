package com.bigb.pos;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/**
 * Sends ESC/POS bytes to a paired printer over classic Bluetooth (serial port profile),
 * which is how Xprinter-type receipt printers ("Printer001") talk to Android.
 */
@SuppressLint("MissingPermission") // callers check BLUETOOTH_CONNECT first (MainActivity)
final class BluetoothPrinter implements AutoCloseable {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private final BluetoothSocket socket;
    private final OutputStream out;

    private BluetoothPrinter(BluetoothSocket socket) throws IOException {
        this.socket = socket;
        this.out = socket.getOutputStream();
    }

    static BluetoothPrinter connect(String address) throws IOException {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IOException("แท็บเล็ตนี้ไม่มีบลูทูธ");
        if (!adapter.isEnabled()) throw new IOException("บลูทูธปิดอยู่ เปิดบลูทูธแล้วลองอีกครั้ง");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        adapter.cancelDiscovery(); // discovery makes RFCOMM connects slow or fail

        IOException first;
        BluetoothSocket socket = null;
        try {
            socket = device.createRfcommSocketToServiceRecord(SPP);
            socket.connect();
            return new BluetoothPrinter(socket);
        } catch (IOException e) {
            first = e;
            closeQuietly(socket);
        }
        // Many low-cost printers only answer on RFCOMM channel 1 without an SDP lookup.
        try {
            socket = (BluetoothSocket) device.getClass()
                    .getMethod("createRfcommSocket", int.class)
                    .invoke(device, 1);
            socket.connect();
            return new BluetoothPrinter(socket);
        } catch (Exception e) {
            closeQuietly(socket);
            IOException error = new IOException("เชื่อมต่อเครื่องพิมพ์ไม่ได้ ตรวจว่าเครื่องพิมพ์เปิดอยู่และอยู่ใกล้แท็บเล็ต", first);
            error.addSuppressed(e);
            throw error;
        }
    }

    void write(byte[] data) throws IOException {
        // Small chunks with a short pause: the printer's buffer is small and SPP has little flow control.
        int chunk = 512;
        for (int i = 0; i < data.length; i += chunk) {
            out.write(data, i, Math.min(chunk, data.length - i));
            out.flush();
            sleep(12);
        }
    }

    /** Closing the socket too early cuts the end of the slip off on some printers. */
    void drain(int bytesSent) {
        sleep(Math.min(6000, 400 + bytesSent / 15));
    }

    @Override
    public void close() {
        closeQuietly(socket);
    }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (IOException ignored) { }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
