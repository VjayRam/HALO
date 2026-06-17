import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingInfoState,
  type ColumnSizingState,
  type Header,
  type RowData,
  type Table as TanStackTable,
  type Updater,
} from "@tanstack/react-table";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  TouchEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  DownloadCloud,
  Layers3,
  ListTree,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Skeleton, cn } from "~/lib/ui";
import { FilterSelect } from "~/components/FilterSelect";
import type { DateRange } from "~/lib/format";
import type { ObservationKind } from "../../server/telemetry/types";

export type LogRowStatus = "error" | "ok" | "running";
export type LogColumnAlign = "left" | "right";
export type LogSortOrder = "asc" | "desc";

export type LogTableColumn<
  TData extends RowData,
  TSortKey extends string = string,
> = {
  id: string;
  header: string;
  defaultTrack: string;
  size: number;
  minSize: number;
  maxSize?: number;
  align?: LogColumnAlign;
  sortKey?: TSortKey;
  cell: (row: TData) => ReactNode;
};

type LogTableColumnMeta<TSortKey extends string = string> = {
  align?: LogColumnAlign;
  sortKey?: TSortKey;
};

type ResizableLogTable<TData extends RowData> = {
  gridStyle: CSSProperties;
  headerRef: (element: HTMLDivElement | null) => void;
  registerHeaderCell: (
    columnId: string,
  ) => (element: HTMLSpanElement | null) => void;
  resizeColumnBy: (columnId: string, delta: number) => void;
  startResize: (
    header: Header<TData, unknown>,
    event: MouseEvent<HTMLSpanElement> | TouchEvent<HTMLSpanElement>,
  ) => void;
  table: TanStackTable<TData>;
};

const DEFAULT_COLUMN_SIZING_INFO: ColumnSizingInfoState = {
  columnSizingStart: [],
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: false,
  startOffset: null,
  startSize: null,
};

export function useResizableLogTable<
  TData extends RowData,
  TSortKey extends string = string,
>({
  columns,
  data,
  getRowId,
  storageKey,
}: {
  columns: LogTableColumn<TData, TSortKey>[];
  data: TData[];
  getRowId: (row: TData) => string;
  storageKey: string;
}): ResizableLogTable<TData> {
  const storedSizing = useMemo(
    () => readStoredColumnSizing(storageKey, columns),
    [columns, storageKey],
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    () => storedSizing ?? defaultColumnSizing(columns),
  );
  const [columnSizingInfo, setColumnSizingInfo] =
    useState<ColumnSizingInfoState>(DEFAULT_COLUMN_SIZING_INFO);
  const [usesPixelSizing, setUsesPixelSizing] = useState(
    () => storedSizing !== null,
  );
  const headerRootRef = useRef<HTMLDivElement | null>(null);
  const headerCellRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const columnDefs = useMemo<ColumnDef<TData, unknown>[]>(
    () =>
      columns.map((column) => ({
        cell: (context) => column.cell(context.row.original),
        enableResizing: true,
        header: column.header,
        id: column.id,
        maxSize: column.maxSize,
        meta: {
          align: column.align,
          sortKey: column.sortKey,
        } satisfies LogTableColumnMeta<TSortKey>,
        minSize: column.minSize,
        size: column.size,
      })),
    [columns],
  );

  const persistSizing = useCallback(
    (next: ColumnSizingState) => {
      if (typeof window === "undefined") return;
      const sanitized = sanitizeColumnSizing(next, columns);
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ columns: sanitized, version: 1 }),
        );
      } catch {
        // Restricted storage contexts should not break resizing.
      }
    },
    [columns, storageKey],
  );

  const updateUserSizing = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setUsesPixelSizing(true);
      setColumnSizing((current) => {
        const next = sanitizeColumnSizing(
          resolveUpdater(updater, current),
          columns,
        );
        persistSizing(next);
        return next;
      });
    },
    [columns, persistSizing],
  );

  const table = useReactTable({
    columnResizeMode: "onChange",
    columns: columnDefs,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    onColumnSizingChange: updateUserSizing,
    onColumnSizingInfoChange: setColumnSizingInfo,
    state: {
      columnSizing,
      columnSizingInfo,
    },
  });

  const measureHeaderSizing = useCallback(() => {
    const measured: ColumnSizingState = {};
    for (const column of columns) {
      const element = headerCellRefs.current[column.id];
      const width = element?.getBoundingClientRect().width;
      if (width && Number.isFinite(width)) {
        measured[column.id] = clampColumnSize(width, column);
      }
    }
    return measured;
  }, [columns]);

  const seedSizingFromHeader = useCallback(() => {
    const measured = measureHeaderSizing();
    if (Object.keys(measured).length === 0) return;
    setColumnSizing((current) =>
      columnSizingEqual(current, measured)
        ? current
        : { ...current, ...measured },
    );
  }, [measureHeaderSizing]);

  useEffect(() => {
    if (usesPixelSizing) return;
    seedSizingFromHeader();
    const element = headerRootRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(seedSizingFromHeader);
    observer.observe(element);
    return () => observer.disconnect();
  }, [seedSizingFromHeader, usesPixelSizing]);

  const gridTemplateColumns = useMemo(() => {
    if (!usesPixelSizing) {
      return columns.map((column) => column.defaultTrack).join(" ");
    }
    return columns
      .map((column) => {
        const size =
          table.getColumn(column.id)?.getSize() ??
          columnSizing[column.id] ??
          column.size;
        return `${Math.round(size)}px`;
      })
      .join(" ");
  }, [columnSizing, columns, table, usesPixelSizing]);

  const gridStyle = useMemo<CSSProperties>(
    () => ({ gridTemplateColumns }),
    [gridTemplateColumns],
  );

  const startResize = useCallback(
    (
      header: Header<TData, unknown>,
      event: MouseEvent<HTMLSpanElement> | TouchEvent<HTMLSpanElement>,
    ) => {
      if (!usesPixelSizing) {
        seedSizingFromHeader();
        setUsesPixelSizing(true);
      }
      header.getResizeHandler()(event);
    },
    [seedSizingFromHeader, usesPixelSizing],
  );

  const resizeColumnBy = useCallback(
    (columnId: string, delta: number) => {
      const column = columns.find((item) => item.id === columnId);
      if (!column) return;
      setUsesPixelSizing(true);
      setColumnSizing((current) => {
        const currentSize =
          current[columnId] ??
          table.getColumn(columnId)?.getSize() ??
          column.size;
        const next = {
          ...current,
          [columnId]: clampColumnSize(currentSize + delta, column),
        };
        persistSizing(next);
        return next;
      });
    },
    [columns, persistSizing, table],
  );

  const registerHeaderCell = useCallback(
    (columnId: string) => (element: HTMLSpanElement | null) => {
      headerCellRefs.current[columnId] = element;
    },
    [],
  );

  const headerRef = useCallback((element: HTMLDivElement | null) => {
    headerRootRef.current = element;
  }, []);

  return {
    gridStyle,
    headerRef,
    registerHeaderCell,
    resizeColumnBy,
    startResize,
    table,
  };
}

function defaultColumnSizing<TData extends RowData>(
  columns: LogTableColumn<TData>[],
): ColumnSizingState {
  return Object.fromEntries(
    columns.map((column) => [column.id, clampColumnSize(column.size, column)]),
  );
}

function readStoredColumnSizing<TData extends RowData>(
  storageKey: string,
  columns: LogTableColumn<TData>[],
): ColumnSizingState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const source =
      isRecord(parsed) && isRecord(parsed.columns) ? parsed.columns : parsed;
    if (!isRecord(source)) return null;

    const sizing: ColumnSizingState = {};
    for (const column of columns) {
      const value = source[column.id];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const max = column.maxSize ?? Number.MAX_SAFE_INTEGER;
      if (value < column.minSize || value > max) continue;
      sizing[column.id] = value;
    }
    return Object.keys(sizing).length > 0 ? sizing : null;
  } catch {
    return null;
  }
}

function sanitizeColumnSizing<TData extends RowData>(
  sizing: ColumnSizingState,
  columns: LogTableColumn<TData>[],
): ColumnSizingState {
  const sanitized: ColumnSizingState = {};
  for (const column of columns) {
    const value = sizing[column.id];
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[column.id] = clampColumnSize(value, column);
    }
  }
  return sanitized;
}

function clampColumnSize<TData extends RowData>(
  value: number,
  column: LogTableColumn<TData>,
): number {
  const max = column.maxSize ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(column.minSize, Math.round(value)));
}

function columnSizingEqual(
  current: ColumnSizingState,
  next: ColumnSizingState,
): boolean {
  return Object.entries(next).every(
    ([columnId, value]) =>
      Math.round(current[columnId] ?? 0) === Math.round(value),
  );
}

function resolveUpdater<TValue>(
  updater: Updater<TValue>,
  current: TValue,
): TValue {
  return typeof updater === "function"
    ? (updater as (current: TValue) => TValue)(current)
    : updater;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteAriaValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : undefined;
}

function handleResizeKeyDown<TData extends RowData>(
  event: KeyboardEvent<HTMLSpanElement>,
  columnId: string,
  logTable: ResizableLogTable<TData>,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  event.stopPropagation();
  logTable.resizeColumnBy(columnId, event.key === "ArrowRight" ? 16 : -16);
}

function nextSortOrder(
  active: boolean,
  currentOrder: LogSortOrder,
): LogSortOrder {
  return active && currentOrder === "desc" ? "asc" : "desc";
}

function sortOrderLabel(order: LogSortOrder): string {
  return order === "asc" ? "ascending" : "descending";
}

function headerText<TData extends RowData>(
  header: Header<TData, unknown>,
): string {
  const label = header.column.columnDef.header;
  return typeof label === "string" ? label : header.column.id;
}

function SortArrows({
  active,
  order,
}: {
  active: boolean;
  order: LogSortOrder;
}) {
  return (
    <span
      aria-hidden="true"
      className="flex h-4 w-3 shrink-0 flex-col items-center justify-center gap-0.5"
    >
      <span
        className={cn(
          "h-0 w-0 border-x-[4px] border-b-[5px] border-x-transparent border-b-current",
          active && order === "asc"
            ? "text-muted-foreground"
            : "text-muted-foreground/40",
        )}
      />
      <span
        className={cn(
          "h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-current",
          active && order === "desc"
            ? "text-muted-foreground"
            : "text-muted-foreground/40",
        )}
      />
    </span>
  );
}

/** Visual status for a list row: live rows pulse, error rows tint red. */
export function logRowStatus(input: {
  hasError: boolean;
  isRecent: boolean;
}): LogRowStatus {
  if (input.hasError) return "error";
  if (input.isRecent) return "running";
  return "ok";
}

export function ResizableLogTableHeader<
  TData extends RowData,
  TSortKey extends string = string,
>({
  logTable,
  onSortChange,
  sortBy,
  sortOrder = "desc",
}: {
  logTable: ResizableLogTable<TData>;
  onSortChange?: (sortKey: TSortKey, sortOrder: LogSortOrder) => void;
  sortBy?: TSortKey;
  sortOrder?: LogSortOrder;
}) {
  const headers = logTable.table.getHeaderGroups()[0]?.headers ?? [];

  return (
    <div
      className={cn(
        "sticky top-0 z-10 grid items-center gap-3 border-b border-border/50 bg-background px-6 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
      )}
      ref={logTable.headerRef}
      style={logTable.gridStyle}
    >
      {headers.map((header) => {
        const meta = header.column.columnDef.meta as
          | LogTableColumnMeta<TSortKey>
          | undefined;
        const sortKey = meta?.sortKey;
        const sortHandler = onSortChange;
        const sortable = Boolean(sortKey && sortHandler);
        const isSorted = Boolean(sortKey && sortBy === sortKey);
        const label = headerText(header);
        const nextOrder = nextSortOrder(isSorted, sortOrder);
        const resizing =
          logTable.table.getState().columnSizingInfo.isResizingColumn ===
          header.column.id;
        return (
          <span
            className={cn(
              "relative min-w-0",
              meta?.align === "right" && "text-right",
            )}
            key={header.id}
            ref={logTable.registerHeaderCell(header.column.id)}
          >
            {sortable && sortKey && sortHandler ? (
              <button
                aria-label={`Sort ${label} ${sortOrderLabel(nextOrder)}`}
                aria-pressed={isSorted}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-sm text-left uppercase tracking-wide outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-detail-brand/50",
                  isSorted && "text-foreground",
                  meta?.align === "right" && "justify-end",
                )}
                onClick={() => sortHandler(sortKey, nextOrder)}
                type="button"
              >
                <span className="min-w-0 truncate">
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </span>
                <SortArrows active={isSorted} order={sortOrder} />
              </button>
            ) : (
              <span className="block truncate">
                {flexRender(header.column.columnDef.header, header.getContext())}
              </span>
            )}
            {header.column.getCanResize() ? (
              <span
                aria-label={`Resize ${String(header.column.columnDef.header)} column`}
                aria-orientation="vertical"
                aria-valuemax={finiteAriaValue(header.column.columnDef.maxSize)}
                aria-valuemin={finiteAriaValue(header.column.columnDef.minSize)}
                aria-valuenow={Math.round(header.column.getSize())}
                className={cn(
                  "absolute -right-2 top-1/2 z-20 h-7 w-4 -translate-y-1/2 cursor-col-resize touch-none select-none rounded-sm outline-none",
                  "after:absolute after:left-1/2 after:top-1 after:h-5 after:w-px after:-translate-x-1/2 after:rounded-full after:bg-border/70 after:opacity-0 after:transition-opacity",
                  "hover:after:opacity-100 focus-visible:ring-1 focus-visible:ring-detail-brand/50 focus-visible:after:opacity-100",
                  resizing && "after:bg-detail-brand after:opacity-100",
                )}
                onKeyDown={(event) =>
                  handleResizeKeyDown(event, header.column.id, logTable)
                }
                onMouseDown={(event) => logTable.startResize(header, event)}
                onTouchStart={(event) => logTable.startResize(header, event)}
                role="separator"
                tabIndex={0}
              />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

const KIND_ICONS: Partial<Record<ObservationKind, typeof Activity>> = {
  AGENT: Bot,
  CHAIN: ListTree,
  EMBEDDING: Layers3,
  LLM: Sparkles,
  TOOL: Wrench,
};

/** Small rounded glyph tile: icon by span kind, tint by row status. */
export function KindStatusTile({
  kind,
  status,
}: {
  kind: ObservationKind;
  status: LogRowStatus;
}) {
  const Icon = KIND_ICONS[kind] ?? Activity;
  return (
    <span
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-md border",
        status === "error" &&
          "border-detail-failure/40 bg-detail-failure/10 text-detail-failure",
        status === "running" &&
          "trace-pulse border-detail-brand/40 bg-detail-brand/10 text-detail-brand",
        status === "ok" &&
          "border-detail-success/35 bg-detail-success/10 text-detail-success",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
    </span>
  );
}

/**
 * Icon-only import marker for table rows — the full source badge is too wide
 * for the Name column; details live in the tooltip and the detail sheet.
 */
export function SourceGlyph({ title }: { title: string }) {
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center text-detail-brand"
      title={title}
    >
      <DownloadCloud className="h-3.5 w-3.5" />
    </span>
  );
}

/** One-line input/output preview with status-aware tone. */
export function PreviewCell({
  status = "ok",
  text,
}: {
  status?: LogRowStatus;
  text: string | null;
}) {
  if (!text) {
    return (
      <span className="block truncate text-sm text-muted-foreground/50">—</span>
    );
  }
  return (
    <span
      className={cn(
        "block truncate text-sm",
        status === "error"
          ? "text-detail-failure"
          : status === "running"
            ? "text-detail-brand"
            : "text-muted-foreground",
      )}
      title={text}
    >
      {text}
    </span>
  );
}

export function LogTableFooter({
  label,
  shownCount,
  totalCount,
}: {
  label: string;
  shownCount: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-center justify-between px-6 py-3 text-xs text-muted-foreground">
      <span>
        Showing {shownCount.toLocaleString()} {label}
      </span>
      <span>
        {totalCount.toLocaleString()} matching {label}
      </span>
    </div>
  );
}

export function LogTableNextPageLoader() {
  return (
    <div className="grid h-[4.875rem] place-items-center border-b border-border/40">
      <Loader2
        aria-label="Loading more rows"
        className="h-4 w-4 animate-spin text-muted-foreground"
      />
    </div>
  );
}

export function LogTableSkeleton({
  columnCount,
  gridStyle,
  rightAlignedCount = 2,
}: {
  columnCount: number;
  gridStyle: CSSProperties;
  rightAlignedCount?: number;
}) {
  return (
    <div>
      {Array.from({ length: 8 }, (_, index) => (
        <div
          className="grid items-center gap-3 border-b border-border/40 px-6 py-3"
          key={index}
          style={gridStyle}
        >
          {Array.from({ length: columnCount }, (_, columnIndex) => (
            <SkeletonCell
              columnCount={columnCount}
              columnIndex={columnIndex}
              key={columnIndex}
              rightAlignedCount={rightAlignedCount}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonCell({
  columnCount,
  columnIndex,
  rightAlignedCount,
}: {
  columnCount: number;
  columnIndex: number;
  rightAlignedCount: number;
}) {
  if (columnIndex === 0) {
    return <Skeleton className="h-3.5 w-24 rounded" />;
  }
  if (columnIndex === 1) {
    return (
      <span className="flex items-center gap-2.5">
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-3.5 w-32 rounded" />
      </span>
    );
  }
  const rightAligned = columnIndex >= columnCount - rightAlignedCount;
  return (
    <Skeleton
      className={cn(
        "h-3.5 rounded",
        rightAligned ? "ml-auto w-12" : "w-full max-w-64",
      )}
    />
  );
}

export function LiveRangeControl({
  className,
  dateRange,
  onDateRangeChange,
}: {
  className?: string;
  dateRange: DateRange;
  onDateRangeChange: (value: DateRange) => void;
}) {
  return (
    <FilterSelect
      ariaLabel="Time window"
      className={className}
      label="Time window"
      onChange={(value) => onDateRangeChange(value as DateRange)}
      options={[
        { label: "Last hour", value: "1h" },
        { label: "Last 24 hours", value: "24h" },
        { label: "Last 7 days", value: "7d" },
        { label: "All time", value: "all" },
      ]}
      triggerClassName="h-9 w-full"
      value={dateRange}
    />
  );
}

/** Shared row chrome: hover/active/error backgrounds + accent left edge. */
export function logRowClassName(input: {
  active: boolean;
  flash: boolean;
  status: LogRowStatus;
}): string {
  return cn(
    "relative grid w-full items-center gap-3 border-b border-border/40 px-6 py-2.5 text-left transition-colors",
    "before:absolute before:bottom-0 before:left-0 before:top-0 before:w-0.5 before:bg-transparent",
    input.active
      ? "bg-muted before:bg-detail-brand"
      : input.status === "error"
        ? "bg-detail-failure/5 hover:bg-detail-failure/10"
        : "hover:bg-muted/50",
    input.flash && "live-trace-flash",
  );
}

export function MonoCell({
  children,
  className,
  muted = true,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "block truncate font-geist-mono text-xs tabular-nums",
        muted ? "text-muted-foreground" : "text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
