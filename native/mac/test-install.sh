#!/bin/zsh
set -euo pipefail
here=${0:A:h}
fake_home=$(mktemp -d /private/tmp/local-reader-install-test.XXXXXX)
trap 'rm -rf "$fake_home"' EXIT
install_root="$fake_home/Library/Application Support/Local Reader/native-mac"
manifest_dir="$fake_home/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$install_root/StartSpeakingAgent.app" "$manifest_dir"
echo original-binary > "$install_root/local-reader-native-tts"
echo original-agent > "$install_root/StartSpeakingAgent.app/original.txt"
echo original-manifest > "$manifest_dir/com.localreader.native_tts.json"
LOCAL_READER_HOME="$fake_home" "$here/install.sh" hmegielmjgbccfcigkejhpgjbeeedfpj >/dev/null
node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1])); if(v.name!=="com.localreader.native_tts"||v.allowed_origins?.length!==1||v.allowed_origins[0]!=="chrome-extension://hmegielmjgbccfcigkejhpgjbeeedfpj/") process.exit(1)' \
  "$manifest_dir/com.localreader.native_tts.json"
[[ -x "$install_root/local-reader-native-tts" ]]
[[ -x "$install_root/StartSpeakingAgent.app/Contents/MacOS/StartSpeakingAgent" ]]
LOCAL_READER_HOME="$fake_home" "$here/uninstall.sh" >/dev/null
[[ $(cat "$install_root/local-reader-native-tts") == original-binary ]]
[[ $(cat "$install_root/StartSpeakingAgent.app/original.txt") == original-agent ]]
[[ $(cat "$manifest_dir/com.localreader.native_tts.json") == original-manifest ]]

mkdir -p "$fake_home/test-bin"
cp "$here/test-fixtures/chmod" "$fake_home/test-bin/chmod"
chmod 755 "$fake_home/test-bin/chmod"
manifest_path="$manifest_dir/com.localreader.native_tts.json"
set +e
PATH="$fake_home/test-bin:$PATH" \
  LOCAL_READER_FAIL_CHMOD=1 \
  LOCAL_READER_HOME="$fake_home" \
  "$here/install.sh" hmegielmjgbccfcigkejhpgjbeeedfpj >/dev/null 2>"$fake_home/install-error.txt"
failure_status=$?
set -e
[[ "$failure_status" -eq 71 ]]
[[ $(cat "$install_root/local-reader-native-tts") == original-binary ]]
[[ $(cat "$install_root/StartSpeakingAgent.app/original.txt") == original-agent ]]
[[ $(cat "$manifest_path") == original-manifest ]]
[[ ! -e "$install_root/install-receipt.json" ]]
[[ ! -d "$fake_home/Library/Application Support/Local Reader/native-mac-rollback" ]]
grep -q "restored the previous relay, agent, and manifest" "$fake_home/install-error.txt"
echo "installer install, uninstall, and failure rollback tests passed"
