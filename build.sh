#!/bin/bash
# MD 解读 —— APK 构建脚本（aarch64 容器，Android SDK build-tools 34）
set -euo pipefail

Q=/usr/bin/qemu-amd64-static
SDK=/root/android-sdk
BT=$SDK/build-tools/34.0.0
AJ=$SDK/platforms/android-34/android.jar
P=/root/mdlens
OUT=$P/out
APK=$OUT/mdlens.apk

fail() { echo "[build] ✗ $*" >&2; exit 1; }
step() { echo "[build] → $*"; }

[ -x "$Q" ]  || fail "缺少 qemu-amd64-static（aapt2/zipalign 是 x86_64）"
[ -f "$AJ" ] || fail "缺少 android.jar"
[ -f "$BT/lib/d8.jar" ] || fail "缺少 d8.jar"

VC_FILE="$P/.versioncode"
VC=$(cat "$VC_FILE" 2>/dev/null || echo 5)
VC=$((VC + 1))
echo "$VC" > "$VC_FILE"
# manifest 与构建脚本必须同一版本号，否则装上去分不清是哪一版
sed -i "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$VC\"/" "$P/AndroidManifest.xml"
sed -i "s/android:versionName=\"[^\"]*\"/android:versionName=\"2.$VC\"/" "$P/AndroidManifest.xml"
echo "[build] → 版本 2.$VC (code $VC)"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/res"

# ---------- 1. 拼装单文件渲染器 ----------
step "拼装 viewer.html"
python3 "$P/src/assemble.py" || fail "assemble 失败"
[ -s "$P/assets/viewer.html" ] || fail "viewer.html 是空的"
grep -q "marked" "$P/assets/viewer.html" || fail "viewer.html 里没有 marked"

# ---------- 2. 编译资源 ----------
step "编译资源"
"$Q" "$BT/aapt2" compile --dir "$P/res" -o "$OUT/res.zip" || fail "aapt2 compile 失败"

# ---------- 3. 链接资源（主资源用位置参数，不要用 -R） ----------
step "链接资源"
"$Q" "$BT/aapt2" link \
    -o "$OUT/base.apk" \
    -I "$AJ" \
    --manifest "$P/AndroidManifest.xml" \
    -A "$P/assets" \
    --java "$OUT/gen" \
    --min-sdk-version 29 \
    --target-sdk-version 34 \
    --version-code "$VC" \
    --version-name "2.$VC" \
    "$OUT/res.zip" || fail "aapt2 link 失败"

[ -f "$OUT/base.apk" ] || fail "base.apk 没生成"

# ---------- 4. 编译 Java ----------
step "编译 Java"
find "$P/src" "$OUT/gen" -name "*.java" > "$OUT/sources.txt"
grep -c . "$OUT/sources.txt" >/dev/null || fail "没有 Java 源文件"
javac --release 17 -encoding UTF-8 -classpath "$AJ" -d "$OUT/classes" @"$OUT/sources.txt" \
    || fail "javac 失败"

NCLASS=$(find "$OUT/classes" -name "*.class" | wc -l)
[ "$NCLASS" -ge 2 ] || fail "只编译出 $NCLASS 个 class，明显不对"

# ---------- 5. dex ----------
step "生成 dex"
find "$OUT/classes" -name "*.class" > "$OUT/classes.txt"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
    --lib "$AJ" --min-api 29 --output "$OUT/dex" @"$OUT/classes.txt" \
    || fail "d8 失败"
[ -s "$OUT/dex/classes.dex" ] || fail "classes.dex 没生成"
DEXSIZE=$(stat -c %s "$OUT/dex/classes.dex")

# ---------- 6. 打包 ----------
step "打包"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
python3 - "$OUT/unsigned.apk" "$OUT/dex/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, "a", zipfile.ZIP_STORED) as z:
    z.write(dex, "classes.dex")
print("[build]   classes.dex 已加入")
PY

"$Q" "$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk" || fail "zipalign 失败"
[ -s "$OUT/aligned.apk" ] || fail "zipalign 输出为空"

# ---------- 7. 签名 ----------
step "签名"
if [ ! -f "$P/debug.keystore" ]; then
    keytool -genkeypair -keystore "$P/debug.keystore" -alias androiddebugkey \
        -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 \
        -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1 \
        || fail "keytool 生成密钥失败"
fi
java -jar "$BT/lib/apksigner.jar" sign \
    --ks "$P/debug.keystore" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --v1-signing-enabled true --v2-signing-enabled true \
    --out "$APK" "$OUT/aligned.apk" || fail "apksigner 签名失败"

# ---------- 8. 验证 ----------
step "验签"
java -jar "$BT/lib/apksigner.jar" verify --verbose "$APK" > "$OUT/verify.txt" 2>&1 \
    || fail "APK 验签失败"
grep -q "Verifies" "$OUT/verify.txt" || fail "验签输出异常"

# ---------- 9. 内容断言（不只看"脚本说 OK"） ----------
step "内容断言"
python3 - "$APK" <<'PY'
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
