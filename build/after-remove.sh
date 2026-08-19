#!/bin/bash
# Custom deb/rpm post-remove for Splitser (runs as rpm %postun / deb postrm).
#
# WHY THIS EXISTS: after-install.sh registers the launcher with
#   update-alternatives --install /usr/bin/splitser splitser /opt/Splitser/splitser 100
# but we never overrode the post-remove, so electron-builder's DEFAULT %postun tried to
# `update-alternatives --remove` a path we never registered (/usr/bin/splitser instead of
# /opt/Splitser/splitser). On Fedora's dnf5 that scriptlet exit code FAILED the whole RPM
# transaction on upgrade:
#   /usr/bin/splitser has not been configured as an alternative for splitser
#   [RPM] %postun(splitser-…) scriptlet failed, exit status 2  ->  Rpm transaction failed.
#
# This removes the EXACT alternative we installed, only on a real uninstall (not an upgrade --
# on upgrade the new package's %post owns the alternative), and never returns non-zero.
#
#   rpm  %postun arg $1: a COUNT -- 0 = final removal, >=1 = upgrade.
#   deb  postrm  arg $1: a WORD  -- remove/purge = removal, upgrade/failed-upgrade = upgrade.
case "$1" in
    0|remove|purge)
        if type update-alternatives >/dev/null 2>&1; then
            update-alternatives --remove 'splitser' '/opt/Splitser/splitser' 2>/dev/null || true
        fi
        if [ -L '/usr/bin/splitser' ] && [ "$(readlink -f '/usr/bin/splitser' 2>/dev/null)" = '/opt/Splitser/splitser' ]; then
            rm -f '/usr/bin/splitser' 2>/dev/null || true
        fi
        ;;
esac
exit 0
