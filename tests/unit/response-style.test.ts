import { describe, expect, test } from "bun:test"

import { chatCapabilities, learningInstructions, styleInstruction, tutorInstruction } from "../../src/llm/response-style"

describe("instructions", () => {
  test("brief, normal and detailed are distinct", () => {
    expect(styleInstruction("brief")).toContain("1-3 short paragraphs")
    expect(styleInstruction("normal")).toContain("2-5 paragraphs")
    expect(styleInstruction("detailed")).toContain("thorough")
  })

  test("the tutor policy is appended after the style", () => {
    const text = learningInstructions("brief", "socratic", chatCapabilities("skill"))
    expect(text.indexOf("Response style")).toBeLessThan(text.indexOf("Tutoring policy"))
    expect(text).toContain("Ask one question at a time")
    expect(tutorInstruction("direct")).toContain("Answer the learner's question directly")
  })

  test("each surface only gets the controls that apply to it", () => {
    expect(chatCapabilities("chill")).toEqual({ responseStyle: false, tutorPolicy: false })
    expect(chatCapabilities(undefined)).toEqual({ responseStyle: false, tutorPolicy: false })
    expect(chatCapabilities("lockin")).toEqual({ responseStyle: true, tutorPolicy: false })
    expect(chatCapabilities("work")).toEqual({ responseStyle: true, tutorPolicy: false })
    expect(chatCapabilities("skill")).toEqual({ responseStyle: true, tutorPolicy: true })

    // Chill's prompt never mentions tutoring or a response style.
    expect(learningInstructions("detailed", "socratic", chatCapabilities("chill"))).toBe("")
    const lockin = learningInstructions("brief", "socratic", chatCapabilities("lockin"))
    expect(lockin).toContain("Response style")
    expect(lockin).not.toContain("Tutoring policy")
    expect(learningInstructions("brief", "socratic", chatCapabilities("skill"))).toContain("Tutoring policy")
  })
})
