#!/bin/zsh
set -euo pipefail

host_name=com.localreader.native_tts
production_extension_id=hmegielmjgbccfcigkejhpgjbeeedfpj
user_home=${LOCAL_READER_HOME:-$HOME}
install_root="$user_home/Library/Application Support/Local Reader/native-mac"
rollback_root="$user_home/Library/Application Support/Local Reader/native-mac-rollback"
manifest_path="$user_home/Library/Application Support/Google/Chrome/NativeMessagingHosts/$host_name.json"
receipt_path="$install_root/install-receipt.json"

if [[ ! -f "$receipt_path" ]]; then
  echo "No Local Reader install receipt found; refusing to remove possibly unrelated files." >&2
  exit 3
fi
backup_dir=$(plutil -extract backupDir raw "$receipt_path")
had_binary=$(plutil -extract hadBinary raw "$receipt_path")
had_agent=$(plutil -extract hadAgent raw "$receipt_path")
had_manifest=$(plutil -extract hadManifest raw "$receipt_path")
extension_id=$(plutil -extract extensionId raw "$receipt_path")

case "$backup_dir" in
  "$rollback_root"/*)
    backup_leaf=${backup_dir#"$rollback_root"/}
    if [[ -z "$backup_leaf" || "$backup_leaf" == */* || "$backup_leaf" == . || "$backup_leaf" == .. ]]; then
      echo "Install receipt has an invalid rollback directory; refusing to remove files." >&2
      exit 4
    fi
    ;;
  *) echo "Install receipt has an invalid rollback directory; refusing to remove files." >&2; exit 4 ;;
esac
if [[ "$extension_id" != "$production_extension_id" ||
      ( "$had_binary" != true && "$had_binary" != false ) ||
      ( "$had_agent" != true && "$had_agent" != false ) ||
      ( "$had_manifest" != true && "$had_manifest" != false ) ]]; then
  echo "Install receipt is invalid; refusing to remove files." >&2
  exit 4
fi
if [[ ! -d "$backup_dir" || -L "$backup_dir" ||
      ( "$had_binary" == true && ! -f "$backup_dir/local-reader-native-tts" ) ||
      ( "$had_agent" == true && ! -d "$backup_dir/StartSpeakingAgent.app" ) ||
      ( "$had_manifest" == true && ! -f "$backup_dir/$host_name.json" ) ]]; then
  echo "Rollback files are incomplete; refusing to remove the current installation." >&2
  exit 4
fi

rm -f "$manifest_path" "$install_root/local-reader-native-tts"
rm -rf "$install_root/StartSpeakingAgent.app"
if [[ "$had_binary" == true ]]; then cp -p "$backup_dir/local-reader-native-tts" "$install_root/local-reader-native-tts"; fi
if [[ "$had_agent" == true ]]; then cp -pR "$backup_dir/StartSpeakingAgent.app" "$install_root/StartSpeakingAgent.app"; fi
if [[ "$had_manifest" == true ]]; then cp -p "$backup_dir/$host_name.json" "$manifest_path"; fi

rm -f "$receipt_path"
rm -f "$backup_dir/local-reader-native-tts" "$backup_dir/$host_name.json"
rm -rf "$backup_dir/StartSpeakingAgent.app"
rmdir "$backup_dir" 2>/dev/null || true
rmdir "$install_root" 2>/dev/null || true
echo "Removed $host_name and restored all files that existed before installation."
