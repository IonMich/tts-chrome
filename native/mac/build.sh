#!/bin/zsh
set -euo pipefail
here=${0:A:h}
build="$here/.build"
app="$build/StartSpeakingAgent.app"
mkdir -p "$build/module-cache" "$app/Contents/MacOS"
xcrun clang -O2 -fobjc-arc -framework AppKit -framework Foundation \
  -fmodules-cache-path="$build/module-cache" \
  "$here/StartSpeakingAgent.m" -o "$app/Contents/MacOS/StartSpeakingAgent"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>StartSpeakingAgent</string>
  <key>CFBundleIdentifier</key><string>local.localreader.StartSpeakingAgent</string>
  <key>CFBundleName</key><string>Local Reader Speech</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
xcrun swiftc -O -module-cache-path "$build/module-cache" \
  "$here/NativeMessagingRelay.swift" -o "$build/local-reader-native-tts"
codesign --force --deep --sign - "$app"
codesign --force --sign - "$build/local-reader-native-tts"
echo "$build/local-reader-native-tts"
