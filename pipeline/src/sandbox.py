"""Startet ein KI-generiertes Prüfskript eingeschränkt: python3 -I sandbox.py verify.py

Kein vollwertiger Container (dafür bräuchte es User-Namespaces/bwrap), aber mehrere Riegel:
- Ressourcen-Limits (Speicher, CPU, Dateigröße, offene Dateien, keine Kindprozesse)
- Audit-Hook (PEP 578): kein Netzwerk, keine Prozesse, kein ctypes, keine Schreibzugriffe,
  Lesen nur in der Python-Installation und im eigenen Arbeitsverzeichnis.
Prüfskripte brauchen nur Rechnen und print() – alles andere wird mit PermissionError abgebrochen.
"""
import os
import resource
import sys

script = sys.argv[1]
work = os.path.realpath(os.getcwd())
with open(script, encoding="utf-8") as f:
    code = compile(f.read(), script, "exec")

for lim, value in (
    (resource.RLIMIT_AS, 1 << 30),
    (resource.RLIMIT_CPU, 10),
    (resource.RLIMIT_FSIZE, 0),
    (resource.RLIMIT_NOFILE, 32),
    (resource.RLIMIT_CORE, 0),
):
    resource.setrlimit(lim, (value, value))

READABLE = tuple(
    sorted({os.path.realpath(p) for p in (sys.prefix, sys.base_prefix, sys.exec_prefix, "/usr/lib/python3", "/usr/local/lib", work)})
)
BLOCKED_IMPORTS = {"ctypes", "_ctypes", "cffi", "socket", "_socket", "ssl", "_ssl", "subprocess", "_posixsubprocess", "multiprocessing", "mmap", "pty", "fcntl"}
BLOCKED_PREFIXES = (
    "socket.", "subprocess.", "ctypes.", "urllib.", "http.", "ftplib.", "smtplib.", "poplib.", "imaplib.", "telnetlib.", "webbrowser.",
    "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty", "os.kill", "os.killpg", "os.putenv", "os.unsetenv",
    "os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.chmod", "os.chown", "os.chflags", "os.link", "os.symlink", "os.truncate", "os.utime",
    "os.chdir", "shutil.", "mmap.", "pty.", "resource.setrlimit", "resource.prlimit", "sys.unraisablehook", "sqlite3.",
)
WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND


def readable(path):
    p = os.path.realpath(os.fsdecode(path))
    return any(p == root or p.startswith(root + os.sep) for root in READABLE)


def hook(event, args):
    if event == "import" and args[0].split(".")[0] in BLOCKED_IMPORTS:
        raise PermissionError(f"Sandbox: import {args[0]} nicht erlaubt")
    if event.startswith(BLOCKED_PREFIXES):
        raise PermissionError(f"Sandbox: {event} nicht erlaubt")
    if event == "open":
        path, mode, flags = args
        if isinstance(path, int):
            return
        if (mode and any(c in mode for c in "wax+")) or (flags or 0) & WRITE_FLAGS:
            raise PermissionError("Sandbox: Schreiben nicht erlaubt")
        if not readable(path):
            raise PermissionError(f"Sandbox: Lesen von {path} nicht erlaubt")
    if event in ("os.listdir", "os.scandir") and args and args[0] is not None and not readable(args[0]):
        raise PermissionError("Sandbox: Verzeichnis nicht erlaubt")


sys.addaudithook(hook)
sys.argv = [script]
exec(code, {"__name__": "__main__", "__file__": script, "__builtins__": __builtins__})
