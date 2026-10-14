# Windows startup registration for the production agent.
# On launch the frozen EXE ensures itself under HKCU Run so the agent
# starts with Windows. HKCU needs no administrator rights. Only runs
# for frozen builds; development runs never touch the registry.
# Failures are best-effort and never stop the agent.

from __future__ import annotations

import sys

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "AstralRelay"
TASK_NAME = "AstralRelay"
BACKUP_DIRNAME = "AstralRelay"
BACKUP_FILENAME = "AstralRelay-Agent.exe"


def backup_paths(env=None):
    """Resolve the backup directory and EXE path under %APPDATA%."""
    import os

    source = env if env is not None else os.environ
    base = source.get("APPDATA") or source.get("LOCALAPPDATA")
    if not base:
        return None, None
    from pathlib import Path

    directory = Path(base) / BACKUP_DIRNAME
    return directory, directory / BACKUP_FILENAME


def ensure_backup_copy(exe_path: str | None = None) -> tuple[str, str | None]:
    """Install or repair the backup copy under %APPDATA%.

    Copies the running frozen EXE aside so deleting the original no
    longer kills autostart. Verifies by size on every launch and
    repairs from the running image when missing or damaged. Returns
    (status, backup_path): installed/current/repaired/skipped/failed.
    Never raises.
    """
    import os
    import shutil

    if not getattr(sys, "frozen", False):
        return "skipped", None
    src = exe_path or sys.executable
    directory, dst = backup_paths()
    if not src or directory is None or dst is None:
        return "failed", None
    try:
        src_size = os.path.getsize(src)
        existed = dst.is_file()
        if existed and os.path.getsize(dst) == src_size and src_size > 0:
            return "current", str(dst)
        directory.mkdir(parents=True, exist_ok=True)
        tmp = directory / f".backup-tmp-{os.getpid()}.exe"
        shutil.copy2(src, tmp)
        try:
            os.replace(tmp, dst)
        except OSError:
            # Backup copy may be running from another instance: stop
            # holders (never this process) once, then retry once.
            terminate_holders(str(dst))
            os.replace(tmp, dst)
        return ("repaired" if existed else "installed"), str(dst)
    except OSError:
        try:
            if dst is not None:
                for leftover in directory.glob(".backup-tmp-*.exe"):
                    leftover.unlink(missing_ok=True)
        except OSError:
            pass
        return "failed", None


def terminate_holders(exe_path: str) -> int:
    """Terminate running processes of the agent image, except this process.

    Matches by executable basename (case-insensitive) and never touches
    the calling PID, so builders and CLIs with other names are safe.
    Returns the kill count. Never raises. Used when a locked EXE must
    be replaced during build publish or backup repair.
    """
    import ctypes
    import os
    import subprocess

    try:
        target_base = os.path.basename(exe_path).lower()
    except (TypeError, OSError):
        return 0
    if not target_base:
        return 0
    own_pid = os.getpid()
    killed = 0
    try:
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32
        TH32CS_SNAPPROCESS = 0x02
        PROCESS_TERMINATE = 0x0001
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

        class ProcessEntry(ctypes.Structure):
            _fields_ = [
                ("dwSize", wintypes.DWORD),
                ("cntUsage", wintypes.DWORD),
                ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_void_p),
                ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD),
                ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", wintypes.LONG),
                ("dwFlags", wintypes.DWORD),
                ("szExeFile", wintypes.WCHAR * 260),
            ]

        snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if int(snapshot) == -1:
            raise OSError("snapshot failed")
        try:
            entry = ProcessEntry()
            entry.dwSize = ctypes.sizeof(ProcessEntry)
            ok = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
            while ok:
                pid = int(entry.th32ProcessID)
                if pid != own_pid and str(entry.szExeFile).lower() == target_base:
                    handle = kernel32.OpenProcess(
                        PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid
                    )
                    if handle:
                        try:
                            if kernel32.TerminateProcess(handle, 1):
                                killed += 1
                        finally:
                            kernel32.CloseHandle(handle)
                ok = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
        finally:
            kernel32.CloseHandle(snapshot)
        return killed
    except (OSError, AttributeError):
        pass
    try:
        proc = subprocess.run(
            ["taskkill", "/F", "/IM", os.path.basename(exe_path),
             "/FI", f"PID ne {own_pid}"],
            capture_output=True, shell=False, timeout=30,
        )
        return 1 if proc.returncode == 0 else 0
    except (OSError, subprocess.SubprocessError):
        return 0


def ensure_logon_task(exe_path: str) -> str:
    """Register a logon trigger as a second launch layer. Best-effort.

    Survives Run-key deletion. Returns added/current/failed. Never raises.
    """
    import subprocess

    try:
        check = subprocess.run(
            ["schtasks", "/query", "/tn", TASK_NAME],
            capture_output=True, shell=False, timeout=30,
        )
        if check.returncode == 0:
            return "current"
        created = subprocess.run(
            ["schtasks", "/create", "/tn", TASK_NAME, "/tr", f'"{exe_path}"',
             "/sc", "onlogon", "/rl", "limited", "/f"],
            capture_output=True, shell=False, timeout=30,
        )
        return "added" if created.returncode == 0 else "failed"
    except (OSError, subprocess.SubprocessError):
        return "failed"


def _open_run_key(winreg, write: bool):
    access = winreg.KEY_SET_VALUE if write else winreg.KEY_READ
    return winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, access)


def ensure_autorun(exe_path: str | None = None) -> str:
    """Register this EXE for Windows startup. Returns a status word.

    Returns 'added' when newly registered, 'current' when already set
    to this path, 'updated' when an old path was replaced, 'skipped'
    when not a frozen build, and 'failed' when the registry is
    unavailable. Never raises.
    """
    if not getattr(sys, "frozen", False):
        return "skipped"
    target = exe_path or sys.executable
    if not target:
        return "failed"
    try:
        import winreg
    except ImportError:
        return "failed"
    command = f'"{target}"'
    try:
        with _open_run_key(winreg, False) as key:
            try:
                current, _ = winreg.QueryValueEx(key, VALUE_NAME)
            except OSError:
                current = None
    except OSError:
        return "failed"
    if current == command:
        return "current"
    try:
        with _open_run_key(winreg, True) as key:
            winreg.SetValueEx(key, VALUE_NAME, 0, winreg.REG_SZ, command)
    except OSError:
        return "failed"
    return "updated" if current else "added"
