#!/bin/sh
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *" stockpilot.endpx.cloud "*) nginx -t && systemctl reload nginx ;;
esac
