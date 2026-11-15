/**
 * Stacked monograms: a compact row of avatars with an overflow count.
 *
 * One implementation serves the plugin SDK (`avatarGroup()` draws the stack)
 * and the app's agent sidebar. Each avatar is `avatarWidth` cells and every
 * following avatar starts `overlap` cells before the previous one ends, so a
 * renderer that draws in order gets a stacked effect. When the row is too wide,
 * the tail is replaced by `+N`, and the count itself is kept only while it fits.
 */
import { avatarLayout, type AvatarLayout, type AvatarTone } from "./avatar"

export type AvatarGroupItem = {
  id: string
  name: string
  /** Fixed tone, instead of the name hash. */
  tone?: AvatarTone
}

export type AvatarGroupMember = {
  id: string
  name: string
  avatar: AvatarLayout
  tone: AvatarTone
  /** Left offset in the group. */
  x: number
  width: number
  index: number
}

export type AvatarGroupOptions = {
  items: readonly AvatarGroupItem[]
  /** Available columns. */
  width: number
  /** Avatar width; defaults to 4 (`[AB]`). */
  avatarWidth?: number
  /** Cells each avatar starts before the previous ends; defaults to 1. */
  overlap?: number
}

export type AvatarGroupLayout = {
  members: AvatarGroupMember[]
  /** Items replaced by the overflow count. */
  hidden: number
  /** `+N`, or "". */
  overflow: string
  overflowX: number
  totalWidth: number
  width: number
  avatarWidth: number
  overlap: number
}

export function avatarGroupLayout(options: AvatarGroupOptions): AvatarGroupLayout {
  const width = Math.max(0, Math.floor(options.width))
  const avatarWidth = Math.max(1, Math.floor(options.avatarWidth ?? 4))
  const overlap = Math.max(0, Math.min(avatarWidth - 1, Math.floor(options.overlap ?? 1)))
  const step = Math.max(1, avatarWidth - overlap)
  const items = options.items
  if (items.length === 0 || width === 0) {
    return {
      members: [],
      hidden: items.length,
      overflow: "",
      overflowX: 0,
      totalWidth: 0,
      width,
      avatarWidth,
      overlap,
    }
  }

  let shown = items.length
  let hidden = 0
  let groupWidth = 0
  let overflow = ""
  let overflowWidth = 0
  while (shown > 0) {
    groupWidth = avatarWidth + (shown - 1) * step
    hidden = items.length - shown
    overflow = hidden > 0 ? `+${hidden}` : ""
    overflowWidth = overflow === "" ? 0 : 1 + overflow.length
    if (groupWidth + overflowWidth <= width) break
    shown -= 1
  }

  if (shown === 0) {
    const count = `+${items.length}`
    const text = count.length <= width ? count : width === 1 ? "…" : `${count.slice(0, width - 1)}…`
    return {
      members: [],
      hidden: items.length,
      overflow: text,
      overflowX: 0,
      totalWidth: text.length,
      width,
      avatarWidth,
      overlap,
    }
  }

  const members = items.slice(0, shown).map((item, index) => {
    const avatar = avatarLayout({ name: item.name, width: avatarWidth })
    return {
      id: item.id,
      name: item.name,
      avatar,
      tone: item.tone ?? avatar.tone,
      x: index * step,
      width: avatarWidth,
      index,
    }
  })

  const overflowX = shown > 0 ? groupWidth + 1 : 0
  const totalWidth = shown > 0 ? groupWidth + overflowWidth : overflow.length
  return {
    members,
    hidden,
    overflow,
    overflowX,
    totalWidth,
    width,
    avatarWidth,
    overlap,
  }
}
