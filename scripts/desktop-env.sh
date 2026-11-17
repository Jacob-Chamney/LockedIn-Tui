#!/usr/bin/env bash
# Put the project-local Flutter SDK on PATH for this shell.
#
# Install the SDK once with:
#   git clone --depth 1 --branch stable https://github.com/flutter/flutter.git \
#     "${FLUTTER_HOME:-$HOME/.local/share/flutter}"
export FLUTTER_HOME="${FLUTTER_HOME:-$HOME/.local/share/flutter}"
case ":$PATH:" in
  *":$FLUTTER_HOME/bin:"*) ;;
  *) export PATH="$FLUTTER_HOME/bin:$PATH" ;;
esac
