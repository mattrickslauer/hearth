#!/usr/bin/env python3
"""Tiny non-interactive serial reader for CI/headless flashing.

Usage: monitor.py <port> <baud> <seconds>
Best-effort resets the board (CH340/CP210x auto-reset lines), then prints
whatever the node emits for <seconds> and exits. Even if the reset is missed,
the node prints a READING line every few seconds, so a real value is captured.
"""
import sys
import time

import serial  # pyserial

port = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 18.0

ser = serial.Serial(port, baud, timeout=1)

# Auto-reset into normal boot: GPIO0 high (DTR low), pulse EN low (RTS high->low).
try:
    ser.dtr = False
    ser.rts = True
    time.sleep(0.1)
    ser.rts = False
    time.sleep(0.1)
except Exception:
    pass

end = time.time() + secs
while time.time() < end:
    line = ser.readline()
    if line:
        sys.stdout.write(line.decode("utf-8", "replace"))
        sys.stdout.flush()
ser.close()
