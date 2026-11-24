# Bundled fonts

Both faces are SIL Open Font License 1.1; the licence text sits beside each.

| Family | Weights | Used for | Upstream |
|---|---|---|---|
| **JetBrains Mono** | Regular · Medium · SemiBold · Bold | chrome, data, keys, numbers, code | <https://github.com/JetBrains/JetBrainsMono> |
| **IBM Plex Sans** | Regular · Medium · SemiBold · Bold | teaching prose and long-form text | <https://github.com/IBM/plex> |

They are bundled rather than taken from the platform because the shell's look is
part of the product: a terminal-derived mono for structure, a humanist sans for
reading. Font files are not modified; the OFL allows redistribution under the
same licence, which is shipped alongside.

The terminal (OpenTUI) frontend uses the user's own terminal font and does not
bundle these.
