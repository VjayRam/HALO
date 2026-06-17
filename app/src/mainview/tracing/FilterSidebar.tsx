import {
  Activity,
  Filter,
  MessageSquare,
  Search,
} from "lucide-react";

import { Button, Input, Tabs, TabsList, TabsTrigger } from "~/lib/ui";
import { FilterSelect } from "~/components/FilterSelect";
import { toFacetOptions, sourceLabel, type DateRange } from "~/lib/format";
import type { FacetOption } from "../../server/telemetry/types";
import type {
  ScopeFilter,
  SourceFilter,
  StatusFilter,
  TraceMonitorViewMode,
} from "./filters";
import { LiveRangeControl } from "./logTable";

export function FilterSidebar({
  agentName,
  dateRange,
  description,
  facets,
  modelName,
  onAgentNameChange,
  onDateRangeChange,
  onModelNameChange,
  onReset,
  onScopeChange,
  onSearchTextChange,
  onServiceNameChange,
  onSourceChange,
  onStatusChange,
  onViewModeChange,
  scope,
  searchText,
  serviceName,
  source,
  status,
  viewMode,
}: {
  agentName: string;
  dateRange: DateRange;
  description: string;
  facets: Partial<Record<string, FacetOption[]>>;
  modelName: string;
  onAgentNameChange: (value: string) => void;
  onDateRangeChange: (value: DateRange) => void;
  onModelNameChange: (value: string) => void;
  onReset: () => void;
  onScopeChange: (value: ScopeFilter) => void;
  onSearchTextChange: (value: string) => void;
  onServiceNameChange: (value: string) => void;
  onSourceChange: (value: SourceFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onViewModeChange?: (value: TraceMonitorViewMode) => void;
  scope: ScopeFilter;
  searchText: string;
  serviceName: string;
  source: SourceFilter;
  status: StatusFilter;
  viewMode?: TraceMonitorViewMode;
}) {
  return (
    <aside className="border-r border-subtle bg-sidebar">
      <div className="flex h-full flex-col gap-5 p-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Filter className="h-4 w-4" />
            Filters
          </div>
          <p className="text-xs text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
              Search
            </span>
            <Input
              aria-label={
                viewMode === "sessions" ? "Search sessions" : "Search traces"
              }
              className="h-9"
              containerClassname="w-full"
              icon={<Search className="h-4 w-4 text-muted-foreground" />}
              onChange={(event) =>
                onSearchTextChange(event.currentTarget.value)
              }
              placeholder={
                viewMode === "sessions"
                  ? "Search sessions..."
                  : "Search traces..."
              }
              value={searchText}
            />
          </div>
          {viewMode && onViewModeChange ? (
            <div className="space-y-2">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                View
              </span>
              <Tabs
                onValueChange={(value) => {
                  if (value === "traces" || value === "sessions") {
                    onViewModeChange(value);
                  }
                }}
                value={viewMode}
              >
                <TabsList className="grid w-full grid-cols-2 gap-1 rounded-md border border-subtle bg-background-muted p-1 sm:grid sm:w-full">
                  <TabsTrigger
                    className="w-full gap-1.5 px-2 py-1.5 text-xs"
                    value="traces"
                  >
                    <Activity className="h-3.5 w-3.5" />
                    Traces
                  </TabsTrigger>
                  <TabsTrigger
                    className="w-full gap-1.5 px-2 py-1.5 text-xs"
                    value="sessions"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Sessions
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          ) : null}
          <LiveRangeControl
            className="w-full"
            dateRange={dateRange}
            onDateRangeChange={onDateRangeChange}
          />
          <FilterSelect
            label="Status"
            onChange={(value) => onStatusChange(value as StatusFilter)}
            options={[
              { label: "Any status", value: "all" },
              { label: "OK", value: "ok" },
              { label: "Errors", value: "error" },
            ]}
            value={status}
          />
          <FilterSelect
            label="Scope"
            onChange={(value) => onScopeChange(value as ScopeFilter)}
            options={[
              { label: "All spans", value: "all" },
              { label: "Root spans", value: "root" },
              { label: "Entrypoints", value: "entrypoint" },
            ]}
            value={scope}
          />
          <FilterSelect
            label="Source"
            onChange={(value) => onSourceChange(value as SourceFilter)}
            options={toFacetOptions(facets.source, "Any source").map((option) => ({
              ...option,
              label: sourceLabel(option.value, option.label),
            }))}
            value={source}
          />
          <FilterSelect
            label="Service"
            onChange={onServiceNameChange}
            options={toFacetOptions(facets.service_name, "Any service")}
            value={serviceName}
          />
          <FilterSelect
            label="Agent"
            onChange={onAgentNameChange}
            options={toFacetOptions(facets.agent_name, "Any agent")}
            value={agentName}
          />
          <FilterSelect
            label="Model"
            onChange={onModelNameChange}
            options={toFacetOptions(facets.llm_model_name, "Any model")}
            value={modelName}
          />
        </div>

        <Button className="mt-auto" onClick={onReset} variant="outline">
          Reset filters
        </Button>
      </div>
    </aside>
  );
}
