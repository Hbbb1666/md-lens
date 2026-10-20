#!/bin/bash
# MD 解读 —— APK 构建脚本（aarch64 容器，Android SDK build-tools 34）
set -euo pipefail

# 项目根目录（脚本所在位置，不写死）
P="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Android SDK：优先环境变量，其次常见位置
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
BT=$SDK/build-tools/34.0.0
AJ=$SDK/platforms/android-34/android.jar
# aarch64 容器里 aapt2/zipalign 是 x86_64 ELF，需要 qemu 包一层；
# x86_64 主机（普通电脑）直接执行即可
Q=""
if [ "$(uname -m)" = "aarch64" ] && [ -x /usr/bin/qemu-amd64-static ]; then
  Q=/usr/bin/qemu-amd64-static
fi
OUT=$P/out
APK=$OUT/mdlens.apk

fail() { echo "[build] ✗ $*" >&2; exit 1; }
step() { echo "[build] → $*"; }

# Git Bash / MSYS 里 $P 是 /d/work/... 形式，而 javac / d8 / aapt2 / python 都是
# 原生 Windows 程序，不认这种路径（javac 会报 “找不到文件: \d\work\...”）。
# 凡是传给原生程序的路径都过一遍 wp()。
if command -v cygpath >/dev/null 2>&1; then
  # Windows：cygpath -w 自身输出带换行，单路径场景用命令替换即可去掉
  wp()  { cygpath -w "$1"; }
  wpl() { cygpath -w "$1"; }
else
  # 单路径：绝不能带换行（会污染 -classpath 等参数）
  wp()  { printf '%s' "$1"; }
  # 列表项（写进 @file 的）：必须带换行，否则所有路径会粘成一行
  wpl() { printf '%s\n' "$1"; }
fi

[ -x $Q ]  || fail "缺少 qemu-amd64-static（aapt2/zipalign 是 x86_64）"
[ -f "$AJ" ] || fail "缺少 android.jar"
[ -f "$BT/lib/d8.jar" ] || fail "缺少 d8.jar（检查 ANDROID_HOME）"
[ -d "$P/vendor2" ] || fail "缺少 vendor2，请先运行 ./fetch-vendors.sh"

# aapt2 / zipalign 是原生 Windows 程序，路径里有中文（或任何非 ASCII）时
# 会报 "failed to open directory: 系统找不到指定的文件" —— 那不是文件不存在，
# 是编码问题（实测：同一个 res 目录，英文路径 OK，中文路径必挂）。
if printf '%s' "$P" | LC_ALL=C grep -q '[^ -~]'; then
  fail "项目路径含非 ASCII 字符，aapt2 打不开：$P
       换个纯英文路径，或建英文 junction 后从那里构建：
         cmd /c mklink /J D:\\work\\md-lens \"$P\"
         cd /d/work/md-lens && ./build.sh"
fi

# 版本号以 AndroidManifest.xml 里的既有 versionCode 为准，+1 递增。
# 不要再用 .versioncode 当唯一真源：它是 gitignore 的，新克隆时不存在，
# 回退默认值会把 22 直接降到 6（实测踩过，装上去系统当成降级）。
MANIFEST="$P/AndroidManifest.xml"
VC=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' "$MANIFEST" | head -1)
case "$VC" in ''|*[!0-9]*) echo "[build] ✗ 读不出 AndroidManifest.xml 的 versionCode" >&2; exit 1;; esac
VC=$((VC + 1))
echo "$VC" > "$P/.versioncode"
# manifest 与构建脚本必须同一版本号，否则装上去分不清是哪一版
sed -i "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$VC\"/" "$MANIFEST"
sed -i "s/android:versionName=\"[^\"]*\"/android:versionName=\"2.$VC\"/" "$MANIFEST"
echo "[build] → 版本 2.$VC (code $VC)"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/res"

# ---------- 1. 拼装单文件渲染器 ----------
step "拼装 viewer.html"
python3 "$(wp "$P/src/assemble.py")" || fail "assemble 失败"
[ -s "$P/assets/viewer.html" ] || fail "viewer.html 是空的"
grep -q "marked" "$P/assets/viewer.html" || fail "viewer.html 里没有 marked"

# ---------- 2. 编译资源 ----------
step "编译资源"
$Q "$BT/aapt2" compile --dir "$(wp "$P/res")" -o "$(wp "$OUT/res.zip")" || fail "aapt2 compile 失败"

# ---------- 3. 链接资源（主资源用位置参数，不要用 -R） ----------
step "链接资源"
$Q "$BT/aapt2" link \
    -o "$(wp "$OUT/base.apk")" \
    -I "$(wp "$AJ")" \
    --manifest "$(wp "$P/AndroidManifest.xml")" \
    -A "$(wp "$P/assets")" \
    --java "$(wp "$OUT/gen")" \
    --min-sdk-version 29 \
    --target-sdk-version 34 \
    --version-code "$VC" \
    --version-name "2.$VC" \
    "$(wp "$OUT/res.zip")" || fail "aapt2 link 失败"

[ -f "$OUT/base.apk" ] || fail "base.apk 没生成"

# ---------- 4. 编译 Java ----------
step "编译 Java"
find "$P/src" "$OUT/gen" -name "*.java" | while IFS= read -r f; do wpl "$f"; done > "$OUT/sources.txt"
grep -c . "$OUT/sources.txt" >/dev/null || fail "没有 Java 源文件"
javac --release 17 -encoding UTF-8 -classpath "$(wp "$AJ")" -d "$(wp "$OUT/classes")" \
    @"$(wp "$OUT/sources.txt")" || fail "javac 失败"

NCLASS=$(find "$OUT/classes" -name "*.class" | wc -l)
[ "$NCLASS" -ge 2 ] || fail "只编译出 $NCLASS 个 class，明显不对"

# ---------- 5. dex ----------
step "生成 dex"
find "$OUT/classes" -name "*.class" | while IFS= read -r f; do wpl "$f"; done > "$OUT/classes.txt"
java -cp "$(wp "$BT/lib/d8.jar")" com.android.tools.r8.D8 \
    --lib "$(wp "$AJ")" --min-api 29 --output "$(wp "$OUT/dex")" @"$(wp "$OUT/classes.txt")" \
    || fail "d8 失败"
[ -s "$OUT/dex/classes.dex" ] || fail "classes.dex 没生成"
DEXSIZE=$(stat -c %s "$OUT/dex/classes.dex")

# ---------- 6. 打包 ----------
step "打包"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
python3 - "$(wp "$OUT/unsigned.apk")" "$(wp "$OUT/dex/classes.dex")" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_STORED) as z:
    z.write(dex, "classes.dex")
print("[build]   classes.dex 已加入")
PY

$Q "$BT/zipalign" -f -p 4 "$(wp "$OUT/unsigned.apk")" "$(wp "$OUT/aligned.apk")" || fail "zipalign 失败"
[ -s "$OUT/aligned.apk" ] || fail "zipalign 输出为空"

# ---------- 7. 签名 ----------
step "签名"
if [ ! -f "$P/debug.keystore" ]; then
    keytool -genkeypair -keystore "$(wp "$P/debug.keystore")" -alias androiddebugkey \
        -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1 \
        || fail "keytool 生成密钥失败"
fi
java -jar "$(wp "$BT/lib/apksigner.jar")" sign \
    --ks "$(wp "$P/debug.keystore")" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --v1-signing-enabled true --v2-signing-enabled true \
    --out "$(wp "$APK")" "$(wp "$OUT/aligned.apk")" || fail "apksigner 签名失败"

# ---------- 8. 验证 ----------
step "验签"
java -jar "$(wp "$BT/lib/apksigner.jar")" verify --verbose "$(wp "$APK")" > "$OUT/verify.txt" 2>&1 \
    || fail "APK 验签失败"
grep -q "Verifies" "$OUT/verify.txt" || fail "验签输出异常"

# ---------- 9. 内容断言（不只看"脚本说 OK"） ----------
step "内容断言"
python3 - "$(wp "$APK")" <<'PY'
import sys, zipfile
apk = sys.argv[1]
z = zipfile.ZipFile(apk)
names = z.namelist()
need = ["AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/viewer.html"]
for n in need:
    if n not in names:
        sys.exit(f"[build] ✗ APK 里缺 {n}")
html = z.read("assets/viewer.html").decode("utf-8", "replace")
for probe in ["marked.parse", "DOMPurify", "hljs", "__nativeBegin", "markdown-body"]:
    if probe not in html:
        sys.exit(f"[build] ✗ viewer.html 里缺关键片段 {probe}")
dex = z.read("classes.dex")
for probe in [b"MDNative", b"__nativeBegin", b"viewer.html"]:
    if probe not in dex:
        sys.exit(f"[build] ✗ classes.dex 里缺 {probe}")
print(f"[build]   APK 条目 {len(names)} 个，viewer.html {len(html):,} 字符，classes.dex {len(dex):,} 字节")
PY

SIZE=$(stat -c %s "$APK")
echo
echo "[build] ✓ 完成：$APK"
echo "[build]   体积 $((SIZE/1024)) KB ｜ dex $((DEXSIZE/1024)) KB ｜ class $NCLASS 个"
