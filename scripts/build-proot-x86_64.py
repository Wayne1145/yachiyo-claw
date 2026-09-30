"""Build the Android x86_64 PRoot compatibility patch with the pinned NDK.

Run from any directory on Windows: python scripts/build-proot-x86_64.py
Sources and objects remain in the ignored workspace directories.
"""

import concurrent.futures
import json
import pathlib
import re
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMMIT = "6c09638b65797997e33b218a42e5e2c7645cb788"  # Termux v5.1.107.86
SOURCE = ROOT / ".research/proot-release"
OUTPUT = ROOT / ".cache/proot-release"
PATCH = ROOT / "scripts/patches/proot-android-syscalls.patch"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


SOURCE.parent.mkdir(parents=True, exist_ok=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
if not SOURCE.exists():
    run("git", "clone", "--no-checkout", "https://github.com/termux/proot.git", str(SOURCE))
    run("git", "-C", str(SOURCE), "checkout", "--detach", COMMIT)
actual = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
if actual != COMMIT:
    raise SystemExit("PRoot source revision differs from the pinned commit; use a separate clean checkout")
applied = subprocess.run(["git", "-C", str(SOURCE), "apply", "--reverse", "--check", str(PATCH)], capture_output=True)
if applied.returncode:
    run("git", "-C", str(SOURCE), "apply", "--check", str(PATCH))
    run("git", "-C", str(SOURCE), "apply", str(PATCH))

lock = json.loads((ROOT / "toolchain.lock.json").read_text(encoding="utf-8"))
ndk = ROOT / ".tools/android-sdk/ndk" / lock["android"]["ndk"] / "toolchains/llvm/prebuilt/windows-x86_64/bin"
compiler = str(ndk / "clang.exe")
source = SOURCE / "src"
(OUTPUT / "build.h").write_text(
    '#define VERSION "5.1.107.86-yachiyo3"\n#define HAVE_PROCESS_VM\n#define HAVE_SECCOMP_FILTER\n', encoding="utf-8"
)
block = (source / "GNUmakefile").read_text(encoding="utf-8").split("OBJECTS +=", 1)[1].split("define define_from_arch.h", 1)[0]
units = re.findall(r"([\w/.-]+)\.o", block)
flags = ["--target=x86_64-linux-android30", "-D_FILE_OFFSET_BITS=64", "-D_GNU_SOURCE",
         '-DPROOT_UNBUNDLE_LOADER="/unused"', "-I" + str(OUTPUT), "-I" + str(source),
         "-I" + str(ROOT / "scripts/native/talloc"), "-O2", "-fPIE"]


def compile_unit(name):
    obj = OUTPUT / (name.replace("/", "_") + ".o")
    result = subprocess.run([compiler, *flags, "-c", str(source / (name + ".c")), "-o", str(obj)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return obj


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    objects = list(pool.map(compile_unit, units))
binary = OUTPUT / "libyachiyo_proot.so"
run(compiler, *flags, "-pie", *(str(obj) for obj in objects),
    str(ROOT / "android/app/src/main/assets/sandbox/x86_64/libtalloc.so.2"),
    "-Wl,-z,noexecstack", "-Wl,-z,max-page-size=16384", "-o", str(binary))
shutil.copyfile(binary, ROOT / "android/app/src/main/jniLibs/x86_64/libyachiyo_proot.so")
print("Built x86_64 PRoot 5.1.107.86-yachiyo3 from " + COMMIT)
