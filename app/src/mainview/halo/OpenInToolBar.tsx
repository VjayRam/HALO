import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Clipboard, Loader2 } from "lucide-react";

import { Button, Tooltip, toast } from "~/lib/ui";
import { trpc } from "~/trpc";
import {
  buildCodingToolDeepLink,
  buildCodingToolPrompt,
  type CodingTool,
  type CodingToolAvailability,
} from "../../desktop/commands";
import {
  detectInstalledCodingTools,
  openExternalUrl,
} from "~/desktop/desktopBridge";
import { ClaudeMark, CodexMark, CursorMark } from "./toolIcons";

const TOOLS: Array<{
  hint: string;
  icon: ReactNode;
  id: CodingTool;
  label: string;
}> = [
  {
    hint: "Install Cursor or use Copy prompt.",
    icon: <CursorMark className="h-4 w-4" />,
    id: "cursor",
    label: "Cursor",
  },
  {
    hint: "Install Claude Code (and run it once to register the link handler) or use Copy prompt.",
    icon: <ClaudeMark className="h-4 w-4" />,
    id: "claude-code",
    label: "Claude Code",
  },
  {
    hint: "Install the Codex app or use Copy prompt.",
    icon: <CodexMark className="h-4 w-4" />,
    id: "codex",
    label: "Codex",
  },
];

/**
 * Hands a completed run's report to a coding agent. The report is written to
 * disk and the deep link carries a short prompt referencing it, so report
 * size never hits URL limits. Nothing auto-runs — each tool prefills and
 * waits for the user.
 *
 * `stack` renders full-width rows for the details rail; `row` renders a
 * compact inline strip for the conversation.
 */
export function OpenInToolBar({
  layout = "stack",
  runId,
}: {
  layout?: "row" | "stack";
  runId: string;
}) {
  const [availability, setAvailability] =
    useState<CodingToolAvailability | null>(null);
  const [busy, setBusy] = useState<CodingTool | "copy" | null>(null);
  const prepareReport = trpc.halo.runs.prepareReport.useMutation();

  useEffect(() => {
    let cancelled = false;
    void detectInstalledCodingTools().then((tools) => {
      if (!cancelled) setAvailability(tools);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openInTool = async (tool: CodingTool, label: string) => {
    setBusy(tool);
    try {
      const report = await prepareReport.mutateAsync({ runId });
      const ok = await openExternalUrl(buildCodingToolDeepLink(tool, report.path));
      if (ok) {
        toast.success({
          title: `Sent to ${label}`,
          description: "The prompt is prefilled — confirm it inside the tool.",
        });
      } else {
        toast.error({
          title: `Could not open ${label}`,
          description: TOOLS.find((item) => item.id === tool)?.hint,
        });
      }
    } catch (error) {
      toast.error({
        title: "Could not prepare the report",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const copyPrompt = async () => {
    setBusy("copy");
    try {
      const report = await prepareReport.mutateAsync({ runId });
      await navigator.clipboard.writeText(buildCodingToolPrompt(report.path));
      toast.success({
        title: "Prompt copied",
        description: "Paste it into any coding agent.",
      });
    } catch (error) {
      toast.error({
        title: "Could not prepare the report",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const stacked = layout === "stack";
  return (
    <div
      className={
        stacked ? "space-y-2" : "flex flex-wrap items-center gap-2"
      }
    >
      {TOOLS.map((tool) => {
        // Outside the desktop shell we cannot detect installs; leave enabled.
        const detected = availability ? availability[tool.id] : true;
        const button = (
          <Button
            className={stacked ? "w-full justify-start" : undefined}
            disabled={!detected || busy !== null}
            key={tool.id}
            onClick={() => void openInTool(tool.id, tool.label)}
            size="sm"
            variant="outline"
          >
            {busy === tool.id ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <span className="mr-2">{tool.icon}</span>
            )}
            Open in {tool.label}
          </Button>
        );
        return detected ? (
          button
        ) : (
          <Tooltip content={`${tool.label} not detected — ${tool.hint}`} key={tool.id}>
            <span className={stacked ? "block" : undefined}>{button}</span>
          </Tooltip>
        );
      })}
      <Button
        className={
          stacked ? "w-full justify-start text-muted-foreground" : "text-muted-foreground"
        }
        disabled={busy !== null}
        onClick={() => void copyPrompt()}
        size="sm"
        variant="ghost"
      >
        {busy === "copy" ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Clipboard className="mr-2 h-4 w-4" />
        )}
        Copy prompt
      </Button>
    </div>
  );
}
