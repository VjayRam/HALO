import { KeyRound, Loader2, RefreshCcw, Trash2 } from "lucide-react";

import { Badge, Button, Input, Skeleton } from "~/lib/ui";
import { DEFAULT_LANGFUSE_URL, StatusPanel } from "./shared";

export function ConnectStep({
  baseUrl,
  connectingId,
  connectionName,
  connections,
  connectionsLoading,
  isConnecting,
  onBaseUrlChange,
  onConnect,
  onConnectionNameChange,
  onDeleteConnection,
  onPublicKeyChange,
  onReconnectStored,
  onSecretKeyChange,
  publicKey,
  secretKey,
}: {
  baseUrl: string;
  connectingId: string | null;
  connectionName: string;
  connections: Array<{
    baseUrl: string;
    id: string;
    lastStatus: string;
    name: string;
    projectName: string | null;
    publicKey: string;
    updatedAt: string;
  }>;
  connectionsLoading: boolean;
  isConnecting: boolean;
  onBaseUrlChange: (value: string) => void;
  onConnect: () => void;
  onConnectionNameChange: (value: string) => void;
  onDeleteConnection: (id: string) => void;
  onPublicKeyChange: (value: string) => void;
  onReconnectStored: (id: string) => void;
  onSecretKeyChange: (value: string) => void;
  publicKey: string;
  secretKey: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_320px]">
      <div className="space-y-4">
        <StatusPanel
          icon={<KeyRound className="h-4 w-4" />}
          title="Langfuse credentials"
        >
          <p className="text-sm text-muted-foreground">
            Use a project API key pair. HALO stores it locally and uses it
            to import trace history over the Langfuse public API.
          </p>
        </StatusPanel>
        <div className="grid gap-3">
          <Input
            label="Connection name"
            onChange={(event) => onConnectionNameChange(event.currentTarget.value)}
            placeholder="Local Langfuse"
            value={connectionName}
          />
          <Input
            label="API URL"
            onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
            placeholder={DEFAULT_LANGFUSE_URL}
            value={baseUrl}
          />
          <Input
            label="Public key"
            onChange={(event) => onPublicKeyChange(event.currentTarget.value)}
            placeholder="lf_pk_..."
            value={publicKey}
          />
          <Input
            label="Secret key"
            onChange={(event) => onSecretKeyChange(event.currentTarget.value)}
            placeholder="lf_sk_..."
            type="password"
            value={secretKey}
          />
        </div>
        <Button className="w-full" disabled={isConnecting} onClick={onConnect}>
          {isConnecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Connect and discover
        </Button>
      </div>

      <div className="rounded-lg border border-subtle bg-background-muted p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Saved connections</h3>
          <Badge variant="outline">{connections.length}</Badge>
        </div>
        <div className="mt-3 space-y-2">
          {connectionsLoading ? (
            <>
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </>
          ) : connections.length === 0 ? (
            <p className="rounded-md border border-dashed border-subtle p-4 text-sm text-muted-foreground">
              No Langfuse connections saved yet.
            </p>
          ) : (
            connections.map((connection) => (
              <div
                className="rounded-md border border-subtle bg-background p-3"
                key={connection.id}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{connection.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {connection.projectName ?? connection.baseUrl}
                    </p>
                  </div>
                  <Badge
                    variant={
                      connection.lastStatus === "connected"
                        ? "status-success"
                        : "outline"
                    }
                  >
                    {connection.lastStatus}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    className="flex-1"
                    disabled={isConnecting}
                    onClick={() => onReconnectStored(connection.id)}
                    size="sm"
                    variant="secondary"
                  >
                    {connectingId === connection.id ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Connecting…
                      </>
                    ) : (
                      "Use"
                    )}
                  </Button>
                  <Button
                    aria-label="Delete Langfuse connection"
                    disabled={isConnecting}
                    onClick={() => onDeleteConnection(connection.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
