# Android Skills (Google)

This directory vendors selected skills from the official Google Android Skills repository:
https://github.com/android/skills

## Included skills
- `android-cli`: instructions for Android CLI and device/SDK workflows.
- `android-intent-security`: Android component, Intent, and PendingIntent security guidance.

These are agent instructions, not runtime dependencies. They do not prove a build or device test passed.

## Update / install the full catalog
Use the official Android CLI in a development environment where it is installed:
```bash
android skills list
android skills add --all --project=.
```
The official project-specific command installs skills into the supported agent directory for this checkout. To refresh the catalog later:
```bash
android skills update --all
```

Upstream README and installation documentation: https://github.com/android/skills#readme
License: see `LICENSE.txt` (Apache-2.0). Keep this license with the copied upstream skill files.
