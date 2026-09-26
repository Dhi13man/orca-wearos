# Orca Watch

Watch companions for an
[Orca](https://github.com/Dhi13man/orca) desktop host.

## Repository layout

The current Wear OS Expo app is self-contained in [wearos/](wearos/), including
its source, native packages, plugins, dependency lockfile, and build configuration.
Run all app development commands from that directory. Root-level documentation,
license, community files, and GitHub configuration apply to the repository.
A future `watchos/` module can sit beside it; watchOS is not implemented.

## Status

`0.0.1` is a developer preview. A Watch8 has installed and paired with a live
Orca host, and its Attention screen displayed a real dashboard. Conversation and
reply routing have passed isolated runtime tests; physical watch replies, remote
networks, and screen-off notifications have not been verified.

The watch must be able to reach the desktop host over the network. Bluetooth
pairing to a phone alone does not provide an Orca connection, and the phone app
is not changed by this project. The watch has no Tailscale client bundled here.

## Requirements

- Wear OS with Android API 33 or newer.
- An Orca host with Wear RPC support. Until that reaches an Orca release, build
  the host from [the Wear branch](https://github.com/Dhi13man/orca/tree/Dhi13man/ship-orca-wearos)
  at commit `3b222b0a9` or later.
- A network route from the watch to the host. Use a private LAN for `ws://`; use
  a correctly configured `wss://` endpoint for access beyond that LAN.

## Install and pair

Download the signed APK from the [0.0.1 release](https://github.com/Dhi13man/orca-watch/releases/tag/v0.0.1)
and install it on the watch. The package ID is `com.stably.orca.wearos`, which
installs beside earlier developer test builds. Android rejects an update signed
by a different key; preserve an existing app and its data if that check fails.

On the reachable Orca host, run:

```sh
orca serve --wear-pairing --pairing-address <watch-reachable-host-address>
```

Open Orca WearOS on the watch. Enter the endpoint and five-minute code printed
by the host, then tap **Connect**. The host also issues a pairing link that can
be opened on the watch; treat that link as a credential and do not paste it into
issues or logs. Each host needs its own pairing. The watch stores a Wear-scoped
grant; it does not receive desktop runtime credentials or arbitrary RPC access.

## Build

Node 24, pnpm 10.24.0, JDK 17, and the Android SDK are required.

```sh
cd wearos
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm exec expo prebuild --platform android --no-install
bash android/gradlew -p packages/expo-wear-data-layer/jvm-tests test
cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=armeabi-v7a
```

The default Gradle output is signed with Android's standard **debug key**. It is
for local testing and must not be published as a trusted release. Release APKs
need a separate private signing key kept outside the repository. The generated
`wearos/android/` directory and `google-services.json` are ignored by Git.
On Windows, use `android\gradlew.bat` for the native tests and `gradlew.bat`
for the release build in place of the shell wrapper commands above.

## Current limits

- Network loss means the host is unavailable, not that an agent stopped.
- Firebase push is not configured. Background refresh is periodic and cannot
  promise timely screen-off alerts.
- Physical multi-host, SSH-host, and reply acceptance remain open.
- There is no Play Store publication in `0.0.1`.

See [SECURITY.md](SECURITY.md) for the trust boundary and private reporting.

## License

MIT. See [LICENSE](LICENSE).
