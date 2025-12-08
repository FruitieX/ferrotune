"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Server,
  Save,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Globe,
  Hash,
  Image,
  Tag,
  Database,
  Folder,
} from "lucide-react";
import { toast } from "sonner";
import { getClient } from "@/lib/api/client";
import type {
  ServerConfigResponse,
  UpdateServerConfigRequest,
} from "@/lib/api/generated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ServerConfig() {
  const queryClient = useQueryClient();

  // Form state
  const [serverName, setServerName] = useState("");
  const [serverHost, setServerHost] = useState("");
  const [serverPort, setServerPort] = useState("");
  const [maxCoverSize, setMaxCoverSize] = useState("");
  const [readonlyTags, setReadonlyTags] = useState(false);

  // Track if form has unsaved changes
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch server config
  const {
    data: config,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["serverConfig"],
    queryFn: async () => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.getServerConfig();
    },
    staleTime: 30000, // Cache for 30 seconds
  });

  // Initialize form when config loads
  useEffect(() => {
    if (config) {
      setServerName(config.serverName || "");
      setServerHost(config.serverHost || "");
      setServerPort(config.serverPort?.toString() || "");
      setMaxCoverSize(config.maxCoverSize?.toString() || "");
      setReadonlyTags(config.readonlyTags ?? false);
      setHasChanges(false);
    }
  }, [config]);

  // Track changes
  useEffect(() => {
    if (!config) return;

    const changed =
      serverName !== (config.serverName || "") ||
      serverHost !== (config.serverHost || "") ||
      serverPort !== (config.serverPort?.toString() || "") ||
      maxCoverSize !== (config.maxCoverSize?.toString() || "") ||
      readonlyTags !== (config.readonlyTags ?? false);

    setHasChanges(changed);
  }, [config, serverName, serverHost, serverPort, maxCoverSize, readonlyTags]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: UpdateServerConfigRequest) => {
      const client = getClient();
      if (!client) throw new Error("Not connected");
      return client.updateServerConfig(updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["serverConfig"] });
      toast.success("Server configuration saved");
      setHasChanges(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save configuration");
    },
  });

  const handleSave = () => {
    const updates: UpdateServerConfigRequest = {
      serverName:
        serverName !== (config?.serverName || "") ? serverName || null : null,
      serverHost:
        serverHost !== (config?.serverHost || "") ? serverHost || null : null,
      serverPort:
        serverPort !== (config?.serverPort?.toString() || "")
          ? serverPort
            ? parseInt(serverPort, 10)
            : null
          : null,
      maxCoverSize:
        maxCoverSize !== (config?.maxCoverSize?.toString() || "")
          ? maxCoverSize
            ? parseInt(maxCoverSize, 10)
            : null
          : null,
      readonlyTags:
        readonlyTags !== (config?.readonlyTags ?? false) ? readonlyTags : null,
      adminUser: null,
      adminPassword: null,
      configured: null,
    };

    updateMutation.mutate(updates);
  };

  const handleReset = () => {
    if (config) {
      setServerName(config.serverName || "");
      setServerHost(config.serverHost || "");
      setServerPort(config.serverPort?.toString() || "");
      setMaxCoverSize(config.maxCoverSize?.toString() || "");
      setReadonlyTags(config.readonlyTags ?? false);
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Server Configuration
          </CardTitle>
          <CardDescription>
            Configure your Ferrotune server settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="w-5 h-5" />
            Server Configuration
          </CardTitle>
          <CardDescription>
            Configure your Ferrotune server settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="w-5 h-5" />
            <span>Failed to load server configuration</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="w-5 h-5" />
              Server Configuration
            </CardTitle>
            <CardDescription>
              Configure your Ferrotune server settings
            </CardDescription>
          </div>
          {config?.configured && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Using config file
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Configuration loaded from file on disk</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Server Identity */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="serverName" className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-muted-foreground" />
              Server Name
            </Label>
            <Input
              id="serverName"
              placeholder="Ferrotune"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Display name shown in client applications
            </p>
          </div>
        </div>

        <Separator />

        {/* Network Settings */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">
            Network Settings
          </h4>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="serverHost" className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                Host
              </Label>
              <Input
                id="serverHost"
                placeholder="0.0.0.0"
                value={serverHost}
                onChange={(e) => setServerHost(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serverPort" className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-muted-foreground" />
                Port
              </Label>
              <Input
                id="serverPort"
                type="number"
                placeholder="4040"
                value={serverPort}
                onChange={(e) => setServerPort(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Server will need to be restarted for network changes to take effect
          </p>
        </div>

        <Separator />

        {/* Media Settings */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">
            Media Settings
          </h4>

          <div className="space-y-2">
            <Label htmlFor="maxCoverSize" className="flex items-center gap-2">
              <Image className="w-4 h-4 text-muted-foreground" />
              Max Cover Size
            </Label>
            <Input
              id="maxCoverSize"
              type="number"
              placeholder="600"
              value={maxCoverSize}
              onChange={(e) => setMaxCoverSize(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Maximum size in pixels for cover art thumbnails (default: 600)
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-muted-foreground" />
                Read-Only Tags
              </Label>
              <p className="text-xs text-muted-foreground">
                Prevent modifications to audio file metadata
              </p>
            </div>
            <Switch checked={readonlyTags} onCheckedChange={setReadonlyTags} />
          </div>
        </div>

        <Separator />

        {/* Read-only Info */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium text-muted-foreground">
            Storage Paths
          </h4>

          <div className="grid gap-3">
            {config?.databasePath && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <Database className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Database</p>
                  <p className="text-sm font-mono truncate">
                    {config.databasePath}
                  </p>
                </div>
              </div>
            )}
            {config?.cachePath && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Cache</p>
                  <p className="text-sm font-mono truncate">
                    {config.cachePath}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {hasChanges && (
            <Button variant="outline" onClick={handleReset}>
              Reset
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
