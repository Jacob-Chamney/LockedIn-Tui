# Git fixture

Static seed files for the WP-507 change-summary tests.

This folder is **not** a repository and never contains `.git`. A test copies it
into a temporary directory and runs `git init` there with an isolated global
config (`GIT_CONFIG_GLOBAL=/dev/null`) plus `-c user.name` / `-c user.email`, so
nothing depends on the machine's git configuration.

Keep these files plain text and small: the tests assert exact line counts.
