#!/usr/bin/env python3
"""Run a command on a pty and answer terminal queries like a terminal would.

`scripts/perf.ts` measures the first painted frame. A split-footer renderer asks
for a cursor-position report before its first frame and waits up to 120 ms for
the answer; `script(1)` never answers, so the measurement included a terminal
that does not exist. This driver answers CPR (and nothing else), which is what
Ghostty, Kitty, WezTerm and every real terminal do.

Usage: perf-pty.py MARKER COMMAND [ARGS...]
Prints the milliseconds from spawn to the first MARKER in the output, or
`timeout`.
"""

import os
import pty
import select
import sys
import time

MARKER = sys.argv[1].encode()
COMMAND = sys.argv[2:]

started = time.monotonic() * 1000
pid, fd = pty.fork()
if pid == 0:
    try:
        os.execvp(COMMAND[0], COMMAND)
    finally:
        os._exit(127)

# Pin the size the budget is defined at. `script(1)` inherits whatever the
# caller's terminal is; a measurement that changes size is not comparable.
try:
    import fcntl
    import struct
    import termios

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
except Exception:
    pass

seen = b""
answered = 0
deadline = time.monotonic() + 20
first = None

while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if fd in ready:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        seen += chunk
        # Answer every cursor-position query, exactly once each.
        asked = seen.count(b"\x1b[6n")
        while answered < asked:
            try:
                os.write(fd, b"\x1b[1;1R")
            except OSError:
                break
            answered += 1
        if MARKER in seen:
            first = time.monotonic() * 1000 - started
            break

if first is None:
    print("timeout")
else:
    print(f"{first:.1f}")

try:
    os.kill(pid, 9)
except OSError:
    pass
try:
    os.waitpid(pid, 0)
except OSError:
    pass
