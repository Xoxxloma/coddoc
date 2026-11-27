#!/usr/bin/env bash
# Эталон assemble.sh для самопроверки стенда (selftest/asm-ref.mjs).
H="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
m() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
node "$(m "$H")/asm-ref.mjs" "$(m "$1")" "$2" "$3" "$(m "$4")" "$(m "$5")"
