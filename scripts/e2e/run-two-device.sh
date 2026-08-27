#!/usr/bin/env bash
# Two-device (iOS simulator + Android emulator) live sync E2E — BASELINE.
#
# Proves packing-list's shared-trip stack on REAL runtimes, over the real
# transport/crypto/engine, against a hermetic local relay. Four things the
# JS-only suites cannot prove, each mapped to a defect class this app has
# actually had:
#
#   propagation   — an item typed on iOS shows up on Android, live.
#   blind edit    — a pack made on iOS while Android is OFFLINE survives an
#                   edit Android made in the same window without seeing it
#                   (merge.ts § PACKED MERGES ON ITS OWN CLOCK).
#   D1 birth-stamp — packing-list-20260820-1. BOTH devices enable a trip type
#                   the trip has never had (Hiking) inside one offline window;
#                   each independently mints the SAME `gen-<rule>` seed rows.
#                   iOS goes first and packs a hiking-only row; Android enables
#                   it afterwards, so its untouched copy is born LATER. Pre-fix
#                   that younger copy won and the item came back unpacked on
#                   both devices. This is packing's own reported defect, and
#                   the only place it can be proven end to end.
#
#                   It CANNOT be reproduced by re-toggling a type the device
#                   already has: composeItems revives a tombstoned generated
#                   row by carrying its existing id, packed state and addedAt
#                   forward, so nothing younger is minted and no pack is lost.
#                   The first real run of this suite (2026-08-25) failed on
#                   exactly that — the re-toggle flow's own setup assertion —
#                   which is why the D1 phase is authored this way and why its
#                   assertions must never be relaxed to make it pass.
#   cold-start    — iOS is killed, Android writes, iOS relaunches and the
#                   hello backfill pulls what it missed.
#
# The device-reset + per-device Maestro helpers live in the factory-shared
# scripts/e2e/harness-lib.sh (module: e2e-two-device); this script is the
# app-owned ORCHESTRATION — packing's flow sequence and where its offline
# windows fall.
#
# Prerequisites (run by hand by the session that drives this):
#   - mini-relay:  node scripts/e2e/mini-relay.mjs --port 7447
#   - Metro:       EXPO_PUBLIC_SYNC_RELAYS="ws://127.0.0.1:7447,ws://10.0.2.2:7447" \
#                  EXPO_PUBLIC_QA_MODE=1 EXPO_PUBLIC_QA_SHARE_SECRET=<base64-32B> \
#                  npx expo start --port 8081
#     EXPO_PUBLIC_QA_SHARE_SECRET is what pairs the two devices: it turns the
#     seeded Greece trip into a SHARED trip on both (src/qa/fixtures.ts), so
#     there is no pairing gesture to drive.
#   - Debug app installed on both: npx expo run:ios / run:android --no-bundler
#
# Usage: scripts/e2e/run-two-device.sh <ios-sim-udid> [android-serial]
# Maestro drives ONE device at a time (two concurrent drivers destabilise RN),
# so the app is left RUNNING between passes and picks up where it left off.
set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Mac-mini load governor (Uplevel 3 / T5) ──────────────────────────────────
# This two-device run (two device drivers + Metro) is ONE heavy unit; on the 8 GB
# mini heavy work must run one-at-a-time. Re-exec the whole script under the
# factory's machine-wide heavy-lock CLI shim (a no-op on a full-size machine).
# JA_HEAVY_HELD is set once we're inside the lock, so this fires exactly once. If
# the factory sibling isn't present (app repo cloned alone) we run unguarded —
# the lock only matters on the mini, where the factory is always a sibling.
if [ -z "${JA_HEAVY_HELD:-}" ]; then
  _JA_HEAVY="$E2E_DIR/../../../josh-approved-factory/scripts/lib/heavy.mjs"
  if [ -f "$_JA_HEAVY" ]; then
    _JA_APP="$(basename "$(cd "$E2E_DIR/../.." && pwd)")"
    exec node "$_JA_HEAVY" run --label "e2e:$_JA_APP" -- "$0" "$@"
  fi
fi

IOS_UDID="${1:?usage: run-two-device.sh <ios-sim-udid> [android-serial]}"
ANDROID_SERIAL="${2:-emulator-5554}"
# shellcheck source=/dev/null
source "$E2E_DIR/e2e.config.sh"
# shellcheck source=/dev/null
source "$E2E_DIR/harness-lib.sh"

h_step "0/8 Reset both devices"
# Kill the iOS app FIRST: a leftover instance from a prior run would answer
# Android's hello and pollute the fresh baseline within seconds.
h_ios_terminate
# Reinstall + warm-up (NOT Maestro clearState / pm clear — that races
# expo-sqlite's first-launch directory creation so fixtures never seed).
h_reset_android

h_step "1/8 Android: fresh boot, open the shared Greece trip (baseline)"
h_droid 01-android-open.yaml

h_step "2/8 iOS: fresh boot, type in a Kite"
h_ios 02-ios-add.yaml

h_step "3/8 Android: the Kite arrived live"
h_droid 03-android-verify-add.yaml

h_step "4/8 Android OFFLINE; iOS packs the Sunscreen"
h_android_offline
h_ios 04-ios-pack.yaml

h_step "5/8 Android (offline): blind write it never saw the pack behind"
h_droid 05-android-blind-add.yaml

h_step "6/8 Reconnect → the pack AND the blind write both survive"
h_android_online
h_droid 06-android-verify-merge.yaml
h_ios 07-ios-verify-merge.yaml

# The offline window here spans BOTH seats, unlike step 4-5's: iOS makes the
# winning gesture inside it too. Android must never see iOS enable the type or
# make the pack, otherwise its copy of the seed row is a received one rather
# than an independently minted younger one, and the defect is not set up.
h_step "7/8 D1: both devices enable a NEW type apart; iOS packs one of its rows"
h_android_offline
h_ios 08-ios-enable-type-and-pack.yaml
h_droid 09-android-enable-type-offline.yaml
h_android_online
h_droid 10-android-verify-pack-survives.yaml
h_ios 11-ios-verify-pack-survives.yaml

h_step "8/8 Kill iOS; Android writes; relaunch iOS → cold-start backfill"
h_ios_terminate
h_droid 12-android-add-while-ios-dead.yaml
h_ios 13-ios-verify-backfill.yaml

h_write_report baseline true two-device-baseline
h_step "PASS — all two-device sync scenarios green"
