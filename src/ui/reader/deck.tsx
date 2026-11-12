/**
 * Flashcard deck reader.
 *
 * The Markdown file is the truth and the service owns every write: this module
 * flips, moves and asks the port to mark a card. It performs no file IO and
 * keeps no second copy of the card state.
 */
import { parseBinding, type Binding } from "../keymap/registry"
import type { ThemePalette } from "../theme"

export type CardChoice = { text: string; correct: boolean }

export type Card = {
  id: string
  question: string
  answer: string
  missed: boolean
  known: boolean
  choices?: CardChoice[]
}

export type Deck = {
  id: string
  name: string
  cards: Card[]
  /** Set by the service when the deck file does not exist yet. */
  built: boolean
}

export type DeckMark = "missed" | "known" | "clear"

/** The service seam: marking and reloading belong to it, never to the pane. */
export type DeckPort = {
  mark: (deckId: string, cardId: string, mark: DeckMark) => Promise<void>
  reload: (deckId: string) => Promise<Deck>
  tick: (deckId: string, cardId: string) => Promise<void>
}

export type DeckView = {
  cursor: number
  /** Space flips question → answer; flipping writes nothing. */
  flipped: boolean
  /** `M` shows only missed cards. */
  missedOnly: boolean
  chosen?: number | null
  notice?: string | null
}

export const initialDeckView: DeckView = { cursor: 0, flipped: false, missedOnly: false, chosen: null, notice: null }

export function visibleCards(deck: Deck, view: DeckView): Card[] {
  return view.missedOnly ? deck.cards.filter((card) => card.missed) : deck.cards
}

export function currentCard(deck: Deck, view: DeckView): Card | undefined {
  return visibleCards(deck, view)[view.cursor]
}

export function flip(view: DeckView): DeckView {
  return { ...view, flipped: !view.flipped, chosen: null }
}

export function move(deck: Deck, view: DeckView, delta: number): DeckView {
  const count = visibleCards(deck, view).length
  const cursor = count === 0 ? 0 : Math.max(0, Math.min(count - 1, view.cursor + delta))
  return { ...view, cursor, flipped: false, chosen: null }
}

export function toggleMissedOnly(deck: Deck, view: DeckView): DeckView {
  const next = !view.missedOnly
  const count = next ? deck.cards.filter((card) => card.missed).length : deck.cards.length
  return { ...view, missedOnly: next, cursor: count === 0 ? 0 : Math.min(view.cursor, count - 1), flipped: false }
}

export function mark(deck: Deck, view: DeckView, kind: "missed" | "known"): { view: DeckView; mark: DeckMark; cardId: string } | { view: DeckView; notice: string } {
  const card = currentCard(deck, view)
  if (!card) return { view: { ...view, notice: "no card selected" }, notice: "no card selected" }
  const already = kind === "missed" ? card.missed : card.known
  const next: DeckMark = already ? "clear" : kind
  return { view: { ...view, notice: null, chosen: null }, mark: next, cardId: card.id }
}

export function progressLine(deck: Deck): string {
  const known = deck.cards.filter((card) => card.known).length
  const missed = deck.cards.filter((card) => card.missed).length
  return `${known} known · ${missed} missed · ${deck.cards.length} cards`
}

/** Exactly one choice is correct; choosing marks the card known or missed. */
export function correctChoices(card: Card): number[] {
  return (card.choices ?? []).map((choice, index) => (choice.correct ? index : -1)).filter((index) => index >= 0)
}

export type ChoiceOutcome = { kind: "known" | "missed"; index: number } | { kind: "refused"; reason: string }

export function choose(card: Card, index: number): ChoiceOutcome {
  const choices = card.choices ?? []
  if (choices.length === 0) return { kind: "refused", reason: "this card has no choices" }
  if (index < 0 || index >= choices.length) return { kind: "refused", reason: `press 1–${choices.length}` }
  return { kind: choices[index]!.correct ? "known" : "missed", index }
}

export function notBuiltCopy(): string {
  return "this deck is not built yet · press b to build it from the session sources"
}

// ---------------------------------------------------------------- keys

export type DeckIntent = "down" | "up" | "flip" | "missed" | "known" | "shuffle" | "reset" | "missed-only" | "choose" | "close"

const SPECS: Array<{ intent: DeckIntent; key: string; footer: string }> = [
  { intent: "down", key: "j", footer: "j/k move" },
  { intent: "up", key: "k", footer: "" },
  { intent: "flip", key: "tab", footer: "Tab flip" },
  { intent: "missed", key: "m", footer: "m missed" },
  { intent: "known", key: "w", footer: "w known" },
  { intent: "shuffle", key: "s", footer: "s shuffle" },
  { intent: "reset", key: "r", footer: "r reset" },
  { intent: "missed-only", key: "shift+m", footer: "M missed only" },
  { intent: "choose", key: "1", footer: "1–4 choose" },
  { intent: "close", key: "escape", footer: "Esc back" },
]

function parse(key: string): Binding {
  const binding = parseBinding(key)
  if ("reason" in binding) throw new Error(`deck key "${key}": ${binding.message}`)
  return binding
}

export const DECK_KEYS = SPECS.map((spec) => ({ intent: spec.intent, binding: parse(spec.key), footer: spec.footer }))

export function intentFor(name: string, options: { shift?: boolean } = {}): DeckIntent | undefined {
  const lower = name.toLowerCase()
  if (/^[1-4]$/.test(lower)) return "choose"
  const wanted = options.shift && lower.length === 1 ? `shift+${lower}` : lower === "enter" ? "return" : lower
  return DECK_KEYS.find((entry) => entry.binding.kind === "direct" && entry.binding.key === wanted)?.intent
}

export function footerHints(): string {
  return DECK_KEYS.filter((entry) => entry.footer).map((entry) => entry.footer).join(" · ")
}

// ---------------------------------------------------------------- render

export function DeckPane(props: {
  theme: ThemePalette
  width: number
  height: number
  focused: boolean
  deck: Deck
  view: DeckView
}) {
  const palette = () => props.theme
  // A getter, not a captured value: filtering/moving changes the card, and
  // Solid runs this component once.
  const card = () => currentCard(props.deck, props.view)
  const cardLine = () => {
    const current = card()
    if (!current) return "no cards · press r to reset the deck"
    return props.view.flipped ? current.answer : current.question
  }

  return (
    <box width={props.width} height={props.height} flexDirection="column" backgroundColor={palette().panel} paddingX={1}>
      <text fg={props.focused ? palette().primary : palette().muted} wrapMode="none">
        {`${props.focused ? "▸" : " "} DECK · ${props.deck.name}`}
      </text>
      <text fg={palette().secondary} wrapMode="none">
        {progressLine(props.deck)}
      </text>

      {!props.deck.built ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${notBuiltCopy()}`}
        </text>
      ) : (
        <box flexDirection="column">
          <text fg={palette().muted} wrapMode="none">
            {`${props.view.cursor + 1}/${visibleCards(props.deck, props.view).length}${card()?.known ? " · known" : card()?.missed ? " · missed" : ""}`}
          </text>
          <text fg={props.focused ? palette().foreground : palette().muted} wrapMode="none">
            {cardLine()}
          </text>
          {props.view.flipped && card()?.choices
            ? card()!.choices!.map((choice, index) => (
                <text
                  fg={
                    props.view.chosen === index
                      ? choice.correct
                        ? palette().success
                        : palette().error
                      : palette().muted
                  }
                  wrapMode="none"
                >
                  {`${index + 1}. ${choice.text}`}
                </text>
              ))
            : null}
        </box>
      )}

      {props.view.notice ? (
        <text fg={palette().warning} wrapMode="none">
          {`! ${props.view.notice}`}
        </text>
      ) : null}
      <text fg={palette().muted} wrapMode="none">
        {footerHints()}
      </text>
    </box>
  )
}
