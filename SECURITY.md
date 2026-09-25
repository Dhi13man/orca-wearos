# Security policy

## Supported versions

Only the latest release receives security fixes. Upgrade after a security
release.

## Report privately

Use GitHub private vulnerability reporting for this repository. Do not open a
public issue with pairing links, device tokens, host addresses, transcripts,
signing material, or reproduction data from a real account.

Include the affected version, impact, and steps using disposable test data.
Security response is owned by [@Dhi13man](https://github.com/Dhi13man).

## Trust boundary

The watch has a narrow Wear grant, not the host's runtime credentials. The Orca
host authorizes each request and fences replies to the exact published agent
target. A pairing link contains credential material until revoked. Keep it out
of logs and reports.

The watch must reach the host directly. Keep a plain `ws://` listener on a
private network; use a properly authenticated and encrypted `wss://` deployment
for remote access. The project does not provide a public relay, Tailscale on
Wear OS, or guaranteed background push delivery.
