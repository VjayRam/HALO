import { describe, expect, test } from "bun:test";

import {
  linkifyDashboardTags,
  parseDashboardLink,
} from "../src/mainview/halo/reportLinks";

describe("halo report dashboard links", () => {
  test("linkifies bracket-only trace and span tags before markdown parsing", () => {
    const markdown = [
      "See [trace:0123456789abcdef0123456789abcdef].",
      "Open [span:0123456789abcdef0123456789abcdef:fedcba9876543210], then inspect.",
    ].join("\n");

    expect(linkifyDashboardTags(markdown)).toBe(
      [
        "See [trace:0123456789abcdef0123456789abcdef](#halo-trace-0123456789abcdef0123456789abcdef).",
        "Open [span:0123456789abcdef0123456789abcdef:fedcba9876543210](#halo-span-0123456789abcdef0123456789abcdef-fedcba9876543210), then inspect.",
      ].join("\n"),
    );
  });

  test("accepts uppercase and variable-length hex ids but normalizes links", () => {
    const markdown = "Check [TRACE:ABCDEF] and [SPAN:ABCDEF:123ABC].";

    expect(linkifyDashboardTags(markdown)).toBe(
      "Check [trace:abcdef](#halo-trace-abcdef) and [span:abcdef:123abc](#halo-span-abcdef-123abc).",
    );
  });

  test("handles code spans and fences without corrupting markdown", () => {
    const markdown = [
      "Exact inline code `[trace:ABCDEF]` links.",
      "Mixed inline code `look at [trace:ABCDEF]` stays code.",
      "```",
      "[trace:ABCDEF]",
      "```",
    ].join("\n");

    expect(linkifyDashboardTags(markdown)).toBe(
      [
        "Exact inline code [trace:abcdef](#halo-trace-abcdef) links.",
        "Mixed inline code `look at [trace:ABCDEF]` stays code.",
        "```",
        "[trace:ABCDEF]",
        "```",
      ].join("\n"),
    );
  });

  test("does not rewrite an existing markdown link label", () => {
    expect(linkifyDashboardTags("[trace:abcdef](https://example.test)")).toBe(
      "[trace:abcdef](https://example.test)",
    );
  });

  test("parses internal dashboard hrefs with normalized ids", () => {
    expect(parseDashboardLink("#halo-trace-ABCDEF")).toEqual({
      kind: "trace",
      traceId: "abcdef",
    });
    expect(parseDashboardLink("#halo-span-ABCDEF-123ABC")).toEqual({
      kind: "span",
      spanId: "123abc",
      traceId: "abcdef",
    });
    expect(parseDashboardLink("https://example.test")).toBeNull();
  });
});
