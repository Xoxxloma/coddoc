#!/usr/bin/env bash
# Эталон plan.sh для самопроверки стенда: оракул в форме вывода контракта. Путь к counts — в форме node.
H="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
c="$(cygpath -m "$1" 2>/dev/null || echo "$1")"; shift
MSYS2_ARG_CONV_EXCL='*' node "$(cygpath -m "$H" 2>/dev/null || echo "$H")/plan-oracle.mjs" "$c" "$@" ${SM_REF_VARIANT:+--variant "$SM_REF_VARIANT"}
