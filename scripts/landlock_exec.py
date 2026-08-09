#!/usr/bin/env python3
"""Apply a Landlock filesystem policy, then exec the target command.

Usage:
  landlock_exec.py --ro PATH --rw PATH -- -- COMMAND [ARGS...]
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.util
import os
import stat
import sys

LANDLOCK_ACCESS_FS_EXECUTE = 1 << 0
LANDLOCK_ACCESS_FS_WRITE_FILE = 1 << 1
LANDLOCK_ACCESS_FS_READ_FILE = 1 << 2
LANDLOCK_ACCESS_FS_READ_DIR = 1 << 3
LANDLOCK_ACCESS_FS_REMOVE_DIR = 1 << 4
LANDLOCK_ACCESS_FS_REMOVE_FILE = 1 << 5
LANDLOCK_ACCESS_FS_MAKE_CHAR = 1 << 6
LANDLOCK_ACCESS_FS_MAKE_DIR = 1 << 7
LANDLOCK_ACCESS_FS_MAKE_REG = 1 << 8
LANDLOCK_ACCESS_FS_MAKE_SOCK = 1 << 9
LANDLOCK_ACCESS_FS_MAKE_FIFO = 1 << 10
LANDLOCK_ACCESS_FS_MAKE_BLOCK = 1 << 11
LANDLOCK_ACCESS_FS_MAKE_SYM = 1 << 12
LANDLOCK_ACCESS_FS_REFER = 1 << 13
LANDLOCK_ACCESS_FS_TRUNCATE = 1 << 14
LANDLOCK_ACCESS_FS_IOCTL_DEV = 1 << 15

ACCESS_RO = (
    LANDLOCK_ACCESS_FS_EXECUTE
    | LANDLOCK_ACCESS_FS_READ_FILE
    | LANDLOCK_ACCESS_FS_READ_DIR
)
ACCESS_RW = ACCESS_RO | (
    LANDLOCK_ACCESS_FS_WRITE_FILE
    | LANDLOCK_ACCESS_FS_REMOVE_DIR
    | LANDLOCK_ACCESS_FS_REMOVE_FILE
    | LANDLOCK_ACCESS_FS_MAKE_CHAR
    | LANDLOCK_ACCESS_FS_MAKE_DIR
    | LANDLOCK_ACCESS_FS_MAKE_REG
    | LANDLOCK_ACCESS_FS_MAKE_SOCK
    | LANDLOCK_ACCESS_FS_MAKE_FIFO
    | LANDLOCK_ACCESS_FS_MAKE_BLOCK
    | LANDLOCK_ACCESS_FS_MAKE_SYM
    | LANDLOCK_ACCESS_FS_REFER
    | LANDLOCK_ACCESS_FS_TRUNCATE
)

LANDLOCK_RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

# Landlock syscalls are stable across arches in current kernels.
NR_CREATE = 444
NR_ADD = 445
NR_RESTRICT = 446


class RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64)]


class PathBeneathAttr(ctypes.Structure):
    # Kernel UAPI marks this struct packed (u64 + s32, no trailing padding).
    _pack_ = 1
    _fields_ = [
        ("allowed_access", ctypes.c_uint64),
        ("parent_fd", ctypes.c_int32),
    ]


def _libc():
    lib = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
    lib.syscall.restype = ctypes.c_long
    return lib


def _create_ruleset(libc, handled: int) -> int:
    attr = RulesetAttr(handled)
    fd = libc.syscall(
        ctypes.c_long(NR_CREATE),
        ctypes.byref(attr),
        ctypes.c_size_t(ctypes.sizeof(attr)),
        ctypes.c_uint32(0),
    )
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, f"landlock_create_ruleset failed: {os.strerror(err)}")
    return int(fd)


def _rule_path(path: str) -> str:
    """Landlock path-beneath rules require a directory hierarchy root.

    Resolve symlinks first — on Debian, `/bin` → `/usr/bin`. Treating the
    symlink as a non-directory would incorrectly fall back to `/` and allow
    the entire filesystem.
    """
    path = os.path.realpath(path)
    mode = os.stat(path).st_mode
    if stat.S_ISDIR(mode):
        return path
    parent = os.path.dirname(path) or "/"
    return parent


def _add_path(libc, ruleset_fd: int, path: str, access: int) -> None:
    target = _rule_path(path)
    dirfd = os.open(target, os.O_PATH | os.O_CLOEXEC)
    try:
        attr = PathBeneathAttr(access, dirfd)
        rc = libc.syscall(
            ctypes.c_long(NR_ADD),
            ctypes.c_int(ruleset_fd),
            ctypes.c_uint(LANDLOCK_RULE_PATH_BENEATH),
            ctypes.byref(attr),
            ctypes.c_uint32(0),
        )
        if rc != 0:
            err = ctypes.get_errno()
            raise OSError(
                err,
                f"landlock_add_rule failed for {path} (via {target}): {os.strerror(err)}",
            )
    finally:
        os.close(dirfd)


def _restrict(libc, ruleset_fd: int) -> None:
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        err = ctypes.get_errno()
        raise OSError(err, f"prctl(NO_NEW_PRIVS) failed: {os.strerror(err)}")
    rc = libc.syscall(
        ctypes.c_long(NR_RESTRICT),
        ctypes.c_int(ruleset_fd),
        ctypes.c_uint32(0),
    )
    if rc != 0:
        err = ctypes.get_errno()
        raise OSError(err, f"landlock_restrict_self failed: {os.strerror(err)}")


def apply_landlock(ro_paths: list[str], rw_paths: list[str]) -> None:
    libc = _libc()
    handled_candidates = [
        ACCESS_RW | LANDLOCK_ACCESS_FS_IOCTL_DEV,
        ACCESS_RW,
        ACCESS_RW & ~LANDLOCK_ACCESS_FS_REFER & ~LANDLOCK_ACCESS_FS_TRUNCATE,
        ACCESS_RO
        | LANDLOCK_ACCESS_FS_WRITE_FILE
        | LANDLOCK_ACCESS_FS_REMOVE_DIR
        | LANDLOCK_ACCESS_FS_REMOVE_FILE
        | LANDLOCK_ACCESS_FS_MAKE_DIR
        | LANDLOCK_ACCESS_FS_MAKE_REG
        | LANDLOCK_ACCESS_FS_MAKE_SYM,
    ]

    ruleset_fd = -1
    handled = 0
    last_err: Exception | None = None
    for candidate in handled_candidates:
        try:
            ruleset_fd = _create_ruleset(libc, candidate)
            handled = candidate
            break
        except OSError as err:
            last_err = err
    if ruleset_fd < 0:
        raise last_err or RuntimeError("landlock unavailable")

    try:
        for path in ro_paths:
            if os.path.exists(path):
                _add_path(libc, ruleset_fd, path, ACCESS_RO & handled)
        for path in rw_paths:
            if os.path.exists(path):
                _add_path(libc, ruleset_fd, path, ACCESS_RW & handled)
        _restrict(libc, ruleset_fd)
    finally:
        os.close(ruleset_fd)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ro", action="append", default=[], metavar="PATH")
    parser.add_argument("--rw", action="append", default=[], metavar="PATH")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)

    command = list(args.command)
    while command and command[0] == "--":
        command = command[1:]
    if not command:
        print("landlock_exec.py: missing COMMAND", file=sys.stderr)
        return 2

    try:
        apply_landlock(args.ro, args.rw)
    except OSError as err:
        print(f"landlock_exec.py: {err}", file=sys.stderr)
        return 1

    os.execvpe(command[0], command, os.environ)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
