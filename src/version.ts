/**
 * The app version printed by `--version`.
 *
 * `scripts/build.ts` replaces `LOCKEDIN_APP_VERSION` with the release version,
 * so a tagged build does not report the package's development version. The fallback is
 * for source runs (`bun run start`).
 */
export const RELEASE_BUILD = process.env.LOCKEDIN_RELEASE === "1"
export const APP_VERSION = process.env.LOCKEDIN_APP_VERSION ?? "2026.11.12"
