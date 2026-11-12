/**
 * Entry point.
 *
 * All wiring lives in `src/app/boot.ts`; this file only boots, reports a failure
 * as one actionable line, and hands the built dependencies to the shell.
 */
import { render } from "@opentui/solid"
import { FRAME_RATE } from "./ui/frame-rate"
import { StartupGate, splashEnabled } from "./ui/shell/splash"
import { resolveTheme, type ThemeId, type ThemePalette } from "./ui/theme"
import { resolveKittyImageTransport } from "./ui/achievements/image-transport"

import { App } from "./app/App"
import { relaunch } from "./services/relaunch"
import { boot, bootFailureLine } from "./app/boot"
import { parseCli, USAGE } from "./cli"
import { APP_VERSION, RELEASE_BUILD } from "./version"
import { patchConfig } from "./storage/config"

const cli = parseCli(process.argv.slice(2))
if (cli.kind === "error") {
  console.error(`lockedin: ${cli.message}`)
  console.error(USAGE)
  process.exit(2)
}
if (cli.kind === "help") {
  console.log(USAGE)
  process.exit(0)
}
if (cli.kind === "version") {
  console.log(`lockedin ${APP_VERSION}`)
  process.exit(0)
}

const booted = await boot({
  workspaceRoot: cli.workspace,
  onUsageError: (message) => {
    // Usage accounting is best-effort; the turn already produced its answer.
    console.error(`usage: ${message}`)
  },
})

if (!booted.ok) {
  // One line, naming the path and the fix. No stack trace, no empty UI.
  console.error(bootFailureLine(booted.error))
  process.exitCode = 1
} else {
  const { controller, usageStore, scope, settings, workspace, createChat, createGithubArchive, pluginRuntime } = booted.value
  const palette = resolveTheme(
    (settings.theme || undefined) as ThemeId | undefined,
    booted.value.config.ui.custom_theme as Partial<ThemePalette>,
  ).palette
  const mount = () => (
    // The splash is the first frame; the app mounts after the lock closes.
    // Reduced motion and LOCKEDIN_NO_SPLASH skip the gate.
    <StartupGate
      enabled={splashEnabled()}
      palette={palette}
      app={() => (
        <App
          controller={controller}
          createChat={createChat}
          createGithubArchive={createGithubArchive}
          pluginRuntime={pluginRuntime}
          restart={
            RELEASE_BUILD
              ? (prepare) => relaunch({ prepare })
              : undefined
          }
          update={
            RELEASE_BUILD
              ? async () => {
                  // Load the updater after the first frame: its module and the
                  // filesystem imports must not sit on the startup path.
                  const { createUpdateService } = await import("./services/update")
                  return createUpdateService({ current: APP_VERSION })
                }
              : undefined
          }
          usageStore={usageStore}
          chatScope={scope}
          settings={settings}
          keybinds={{
            keybinds: booted.value.config.ui.keybinds,
            fixed_keybinds: booted.value.config.ui.fixed_keybinds,
          }}
          workspace={workspace}
          onUsageError={(message: string) => console.error(`usage: ${message}`)}
          onThemeChange={(id: string) => patchConfig(booted.value.workspace.paths, { ui: { theme: id } })}
          linkProvider={booted.value.linkProvider}
          modelsForProvider={booted.value.modelsForProvider}
          linkedProviders={booted.value.linkedProviders}
          onConfigPatch={async (patch: Record<string, unknown>) => {
            const result = await patchConfig(booted.value.workspace.paths, patch as never)
            if (result.ok) await booted.value.updateConfig(result.value.config)
            return result
          }}
          generate={booted.value.generate}
          generatePlan={
            booted.value.generate
              ? async ({ goal, prior }: { goal: string; prior: string }) => {
                  // One strict ask; anything unparseable throws, and createCourse
                  // falls back to its template rather than writing a bad course.
                  const prompt = [
                    "Write a lesson plan for a coding course.",
                    `Goal: ${goal}`,
                    prior ? `Prior knowledge: ${prior}` : "The learner is starting from scratch.",
                    "Reply with JSON only: an array of chapters, each {\"title\", \"guide\", \"practical\"}.",
                    "guide and practical are Markdown strings. Four to eight chapters, ordered.",
                  ].join("\n")
                  const raw = await booted.value.generate!(prompt)
                  const start = raw.indexOf("[")
                  const end = raw.lastIndexOf("]")
                  if (start === -1 || end === -1) throw new Error("no plan")
                  const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ title?: string; guide?: string; practical?: string }>
                  return parsed.map((chapter) => ({
                    title: chapter.title ?? "",
                    guide: chapter.guide ?? "",
                    practical: chapter.practical ?? "",
                  }))
                }
              : undefined
          }
        />
      )}
    />
  )

  await render(mount, {
    targetFps: FRAME_RATE,
    maxFps: FRAME_RATE,
    kittyImageTransport: resolveKittyImageTransport(),
  })
}
