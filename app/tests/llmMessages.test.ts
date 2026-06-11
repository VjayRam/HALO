import { describe, expect, test } from "bun:test";

import { parseSpanConversation, stringifyContent } from "../src/mainview/tracing/llmMessages";

function spanWith(overrides: {
  input?: string | null;
  inputMessages?: string | null;
  observationKind?: string;
  output?: string | null;
  outputMessages?: string | null;
}) {
  return {
    input: null,
    inputMessages: null,
    observationKind: "LLM",
    output: null,
    outputMessages: null,
    ...overrides,
  };
}

describe("parseSpanConversation", () => {
  test("parses OpenAI-style message arrays with tool calls", () => {
    const conversation = parseSpanConversation(
      spanWith({
        inputMessages: JSON.stringify([
          { role: "system", content: "You are helpful." },
          { role: "user", content: "What is the weather?" },
        ]),
        outputMessages: JSON.stringify([
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                function: { name: "get_weather", arguments: '{"city":"SF"}' },
              },
            ],
          },
        ]),
      }),
    );

    expect(conversation).not.toBeNull();
    expect(conversation?.messages).toHaveLength(3);
    expect(conversation?.messages[0]?.role).toBe("system");
    expect(conversation?.messages[1]?.role).toBe("user");
    const assistant = conversation?.messages[2];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.source).toBe("output");
    expect(assistant?.toolCalls).toEqual([
      { argsRaw: '{"city":"SF"}', id: "call_1", name: "get_weather" },
    ]);
  });

  test("parses OpenInference message wrappers and content parts", () => {
    const conversation = parseSpanConversation(
      spanWith({
        inputMessages: JSON.stringify([
          { message: { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:..." } }] } },
        ]),
      }),
    );

    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]?.content).toBe("hi\n[image]");
  });

  test("links tool results by tool_call_id", () => {
    const conversation = parseSpanConversation(
      spanWith({
        inputMessages: JSON.stringify([
          { role: "tool", tool_call_id: "call_1", content: '{"temp":65}' },
        ]),
      }),
    );

    expect(conversation?.messages[0]?.role).toBe("tool");
    expect(conversation?.messages[0]?.toolCallId).toBe("call_1");
  });

  test("falls back to plain input/output text for LLM spans", () => {
    const conversation = parseSpanConversation(
      spanWith({
        input: "Summarize this article",
        output: "Here is a summary.",
      }),
    );

    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[0]?.role).toBe("user");
    expect(conversation?.messages[1]?.role).toBe("assistant");
  });

  test("returns null for plain-text non-LLM spans", () => {
    const conversation = parseSpanConversation(
      spanWith({
        input: "Start test.span.1",
        observationKind: "CHAIN",
        output: "test.span.1 completed",
      }),
    );

    expect(conversation).toBeNull();
  });

  test("parses structured {messages} payloads in loose input", () => {
    const conversation = parseSpanConversation(
      spanWith({
        input: JSON.stringify({
          messages: [{ role: "user", content: "structured" }],
        }),
        observationKind: "CHAIN",
      }),
    );

    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]?.content).toBe("structured");
  });

  test("returns null when nothing is present", () => {
    expect(parseSpanConversation(spanWith({}))).toBeNull();
  });

  test("survives truncated JSON", () => {
    const conversation = parseSpanConversation(
      spanWith({
        inputMessages: '[{"role":"user","content":"trunca',
      }),
    );
    expect(conversation).toBeNull();
  });
});

describe("stringifyContent", () => {
  test("joins text parts and labels images", () => {
    expect(
      stringifyContent([
        { type: "text", text: "a" },
        { type: "image_url", image_url: { url: "http://x" } },
        "b",
      ]),
    ).toBe("a\n[image]\nb");
  });

  test("handles object content with text field", () => {
    expect(stringifyContent({ text: "inner" })).toBe("inner");
  });
});
