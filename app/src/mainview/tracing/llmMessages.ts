import type { Span } from "../../server/telemetry/types";

export type ThreadRole = "assistant" | "other" | "system" | "tool" | "user";

export type ParsedToolCall = {
  argsRaw: string;
  id?: string;
  name: string;
};

export type ParsedMessage = {
  content: string;
  key: string;
  role: ThreadRole;
  roleLabel: string;
  source: "input" | "output";
  toolCallId?: string;
  toolCalls: ParsedToolCall[];
};

export type ParsedConversation = {
  messages: ParsedMessage[];
};

/**
 * Parse a span's canonical message columns (ingest already normalizes
 * OpenInference / GenAI semconv / Vercel AI shapes into OpenAI-style arrays)
 * into a renderable conversation. Returns null when nothing message-like is
 * present so the caller can fall back to the raw view.
 */
export function parseSpanConversation(span: {
  input: string | null;
  inputMessages: string | null;
  observationKind: string;
  output: string | null;
  outputMessages: string | null;
}): ParsedConversation | null {
  const messages: ParsedMessage[] = [
    ...parseMessagesJson(span.inputMessages, "input"),
    ...parseMessagesJson(span.outputMessages, "output"),
  ];

  if (messages.length === 0) {
    // Plain text only qualifies as a conversation for LLM spans — for tools
    // and chains the raw input/output view reads better.
    const allowPlainText = span.observationKind === "LLM";
    messages.push(...parseLooseValue(span.input, "input", allowPlainText));
    messages.push(...parseLooseValue(span.output, "output", allowPlainText));
  }

  if (messages.length === 0) return null;
  return { messages: messages.map((message, index) => ({ ...message, key: `${message.source}-${index}` })) };
}

function parseMessagesJson(
  raw: string | null,
  source: "input" | "output",
): ParsedMessage[] {
  const parsed = tryParseJson(raw);
  if (!parsed) return [];
  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.messages)
      ? parsed.messages
      : null;
  if (!list) return [];
  return list
    .map((item) => normalizeMessage(item, source))
    .filter((item): item is ParsedMessage => item !== null);
}

function parseLooseValue(
  raw: string | null,
  source: "input" | "output",
  allowPlainText: boolean,
): ParsedMessage[] {
  if (!raw?.trim()) return [];
  const parsed = tryParseJson(raw);
  if (parsed) {
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .map((item) => normalizeMessage(item, source))
        .filter((item): item is ParsedMessage => item !== null);
      if (normalized.length > 0) return normalized;
    }
    if (isRecord(parsed)) {
      if (Array.isArray(parsed.messages)) {
        return parsed.messages
          .map((item) => normalizeMessage(item, source))
          .filter((item): item is ParsedMessage => item !== null);
      }
      const single = normalizeMessage(parsed, source);
      if (single) return [single];
      return [];
    }
    return [];
  }
  if (!allowPlainText) return [];
  // Plain text: treat input as the user turn and output as the assistant turn.
  return [
    {
      content: raw,
      key: "",
      role: source === "input" ? "user" : "assistant",
      roleLabel: source === "input" ? "user" : "assistant",
      source,
      toolCalls: [],
    },
  ];
}

function normalizeMessage(
  value: unknown,
  source: "input" | "output",
): ParsedMessage | null {
  if (!isRecord(value)) return null;
  const inner =
    isRecord(value.message) && !("role" in value) ? value.message : value;
  if (!isRecord(inner)) return null;

  const rawRole =
    typeof inner.role === "string" && inner.role
      ? inner.role
      : typeof inner.type === "string"
        ? inner.type
        : null;
  const toolCalls = normalizeToolCalls(inner);
  const content = stringifyContent(inner.content);
  const hasSignal =
    rawRole !== null || toolCalls.length > 0 || content.trim().length > 0;
  if (!hasSignal) return null;

  const roleLabel = rawRole ?? "message";
  return {
    content,
    key: "",
    role: normalizeRole(roleLabel),
    roleLabel,
    source,
    toolCallId:
      typeof inner.tool_call_id === "string" ? inner.tool_call_id : undefined,
    toolCalls,
  };
}

function normalizeToolCalls(message: Record<string, unknown>): ParsedToolCall[] {
  const raw = message.tool_calls ?? message.toolCalls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): ParsedToolCall | null => {
      if (!isRecord(item)) return null;
      const fn = isRecord(item.function) ? item.function : item;
      const name =
        typeof fn.name === "string"
          ? fn.name
          : typeof item.name === "string"
            ? item.name
            : null;
      if (!name) return null;
      const args = fn.arguments ?? item.arguments ?? item.args;
      return {
        argsRaw:
          typeof args === "string" ? args : args == null ? "" : safeStringify(args),
        id: typeof item.id === "string" ? item.id : undefined,
        name,
      };
    })
    .filter((item): item is ParsedToolCall => item !== null);
}

/** Flatten string | parts-array | object content into displayable text. */
export function stringifyContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.type === "string" && part.type.includes("image")) {
          return "[image]";
        }
        if (isRecord(part.image_url)) return "[image]";
        return safeStringify(part);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (isRecord(content) && typeof content.text === "string") return content.text;
  return safeStringify(content);
}

function normalizeRole(role: string): ThreadRole {
  const normalized = role.toLowerCase();
  if (normalized === "system" || normalized === "developer") return "system";
  if (normalized === "user" || normalized === "human") return "user";
  if (
    normalized === "assistant" ||
    normalized === "ai" ||
    normalized === "model"
  ) {
    return "assistant";
  }
  if (normalized === "tool" || normalized === "function") return "tool";
  return "other";
}

function tryParseJson(raw: string | null): unknown {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type SpanConversationInput = Pick<
  Span,
  "input" | "inputMessages" | "observationKind" | "output" | "outputMessages"
>;
