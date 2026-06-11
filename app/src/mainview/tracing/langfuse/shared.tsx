import type { ReactNode } from "react";

export type DialogStep = "connect" | "select" | "import" | "done";
export type DatePreset = "24h" | "7d" | "30d" | "all";

export const DEFAULT_LANGFUSE_URL = "http://localhost:3001";

export function StatusPanel({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-lg border border-subtle bg-background-muted p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-subtle bg-background px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
