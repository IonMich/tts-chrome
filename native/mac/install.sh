#!/bin/zsh
set -euo pipefail

production_extension_id=hmegielmjgbccfcigkejhpgjbeeedfpj
if [[ $# -ne 1 || "$1" != "$production_extension_id" ]]; then
  echo "Usage: $0 $production_extension_id" >&2
  exit 2
fi

host_name=com.localreader.native_tts
script_dir=${0:A:h}
user_home=${LOCAL_READER_HOME:-$HOME}
install_root="$user_home/Library/Application Support/Local Reader/native-mac"
rollback_root="$user_home/Library/Application Support/Local Reader/native-mac-rollback"
manifest_dir="$user_home/Library/Application Support/Google/Chrome/NativeMessagingHosts"
binary_path="$install_root/local-reader-native-tts"
agent_path="$install_root/StartSpeakingAgent.app"
manifest_path="$manifest_dir/$host_name.json"
receipt_path="$install_root/install-receipt.json"
manifest_tmp="$manifest_dir/.$host_name.$$.tmp"
receipt_tmp="$install_root/.install-receipt.$$.tmp"

if [[ -e "$receipt_path" ]]; then
  echo "An installation receipt already exists. Run uninstall.sh before reinstalling." >&2
  exit 3
fi

"$script_dir/build.sh" >/dev/null
backup_dir="$rollback_root/$(date -u +%Y%m%dT%H%M%SZ)-$$"
transaction_active=false
mutation_started=false
had_binary=false
had_agent=false
had_manifest=false

rollback_install() {
  local install_status=$?
  trap - EXIT HUP INT TERM
  if [[ "$transaction_active" != true ]]; then
    exit "$install_status"
  fi

  set +e
  local rollback_failed=false
  /bin/rm -f "$manifest_tmp" "$receipt_tmp" "$receipt_path" || rollback_failed=true
  if [[ "$mutation_started" == true ]]; then
    /bin/rm -f "$binary_path" "$manifest_path" || rollback_failed=true
    /bin/rm -rf "$agent_path" || rollback_failed=true
    if [[ "$had_binary" == true ]]; then
      /bin/cp -p "$backup_dir/local-reader-native-tts" "$binary_path" || rollback_failed=true
    fi
    if [[ "$had_agent" == true ]]; then
      /bin/cp -pR "$backup_dir/StartSpeakingAgent.app" "$agent_path" || rollback_failed=true
    fi
    if [[ "$had_manifest" == true ]]; then
      /bin/cp -p "$backup_dir/$host_name.json" "$manifest_path" || rollback_failed=true
    fi
  fi

  if [[ "$rollback_failed" == false ]]; then
    /bin/rm -rf "$backup_dir"
    /bin/rmdir "$rollback_root" 2>/dev/null || true
    echo "Installation failed; restored the previous relay, agent, and manifest." >&2
  else
    echo "Installation failed and automatic restoration was incomplete." >&2
    echo "Recovery copies remain at: $backup_dir" >&2
  fi
  exit "$install_status"
}

trap rollback_install EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

transaction_active=true
mkdir -p "$install_root" "$manifest_dir" "$backup_dir"
if [[ -e "$binary_path" ]]; then cp -p "$binary_path" "$backup_dir/local-reader-native-tts"; had_binary=true; fi
if [[ -e "$agent_path" ]]; then cp -pR "$agent_path" "$backup_dir/StartSpeakingAgent.app"; had_agent=true; fi
if [[ -e "$manifest_path" ]]; then cp -p "$manifest_path" "$backup_dir/$host_name.json"; had_manifest=true; fi

mutation_started=true
install -m 755 "$script_dir/.build/local-reader-native-tts" "$binary_path"
rm -rf "$agent_path"
cp -pR "$script_dir/.build/StartSpeakingAgent.app" "$agent_path"
plutil -create xml1 "$manifest_tmp"
plutil -insert name -string "$host_name" "$manifest_tmp"
plutil -insert description -string "Local Reader Mac Start Speaking bridge" "$manifest_tmp"
plutil -insert path -string "$binary_path" "$manifest_tmp"
plutil -insert type -string stdio "$manifest_tmp"
plutil -insert allowed_origins -json "[\"chrome-extension://$production_extension_id/\"]" "$manifest_tmp"
plutil -convert json "$manifest_tmp"
chmod 644 "$manifest_tmp"
mv "$manifest_tmp" "$manifest_path"

plutil -create xml1 "$receipt_tmp"
plutil -insert backupDir -string "$backup_dir" "$receipt_tmp"
plutil -insert hadBinary -bool "$had_binary" "$receipt_tmp"
plutil -insert hadAgent -bool "$had_agent" "$receipt_tmp"
plutil -insert hadManifest -bool "$had_manifest" "$receipt_tmp"
plutil -insert extensionId -string "$production_extension_id" "$receipt_tmp"
chmod 600 "$receipt_tmp"
mv "$receipt_tmp" "$receipt_path"

transaction_active=false
trap - EXIT HUP INT TERM

echo "Installed $host_name for Chrome extension $production_extension_id"
echo "Relay: $binary_path"
echo "Agent: $agent_path"
echo "Manifest: $manifest_path"
echo "Rollback receipt: $receipt_path"
