#!/bin/bash
# Custom deb/rpm post-install script for Splitser.
#
# WHY THIS EXISTS: electron-builder's default post-install decides chrome-sandbox's mode by testing
# `unshare --user true` at install time. On Ubuntu 24.04 (apparmor_restrict_unprivileged_userns=1)
# that test passes for `unshare` but the unconfined app is still DENIED the namespace sandbox, so the
# default leaves chrome-sandbox at 0755 and the app aborts on launch:
#   FATAL ... chrome-sandbox ... is not configured correctly ... mode 4755.
# The SUID sandbox works WITH or WITHOUT user namespaces, so we just always enable it. Safe everywhere.

# Put the binary on PATH (mirrors electron-builder's default behaviour).
if type update-alternatives >/dev/null 2>&1; then
    if [ -L '/usr/bin/splitser' ] && [ -e '/usr/bin/splitser' ] && [ "$(readlink '/usr/bin/splitser')" != '/etc/alternatives/splitser' ]; then
        rm -f '/usr/bin/splitser'
    fi
    update-alternatives --install '/usr/bin/splitser' 'splitser' '/opt/Splitser/splitser' 100 || ln -sf '/opt/Splitser/splitser' '/usr/bin/splitser'
else
    ln -sf '/opt/Splitser/splitser' '/usr/bin/splitser'
fi

# THE FIX: always enable the SUID sandbox helper (unconditionally 4755), so the app launches sandboxed
# from the desktop menu even where the namespace sandbox is blocked.
chmod 4755 '/opt/Splitser/chrome-sandbox' || true

# Refresh desktop / mime databases (mirrors electron-builder's default).
if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
