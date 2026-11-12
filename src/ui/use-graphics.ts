/**
 * Terminal image support, detected once and re-checked briefly after mount.
 *
 * `ImageRenderable` can arrive a frame or two after the component mounts, so a
 * one-time read would leave the list fallback up forever. 10 polls at 200 ms
 * covers startup without a permanent timer on terminals that never answer.
 */
import { createSignal, onCleanup, onMount } from "solid-js"
import { useRenderer } from "@opentui/solid"

export function useGraphics(override?: boolean): () => boolean {
  const renderer = useRenderer()
  const [version, setVersion] = createSignal(0)
  const detected = () => {
    version()
    return Boolean(renderer.capabilities?.kitty_graphics || renderer.capabilities?.sixel)
  }
  onMount(() => {
    if (override !== undefined) return
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      setVersion((value) => value + 1)
      if (detected() || tries >= 10) clearInterval(timer)
    }, 200)
    onCleanup(() => clearInterval(timer))
  })
  return () => override ?? detected()
}
