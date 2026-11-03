import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticDestructive } from "@/lib/utils/haptic";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearQueueAtom,
  clearUpNextAtom,
  serverQueueStateAtom,
} from "@/lib/store/server-queue";

/**
 * Queue header clear action: "Clear up next" removes only explicitly queued
 * songs and keeps the playlist playing; "Clear all" empties the whole queue.
 */
export function QueueClearMenu({ className }: { className?: string }) {
  const queueState = useAtomValue(serverQueueStateAtom);
  const clearQueue = useSetAtom(clearQueueAtom);
  const clearUpNext = useSetAtom(clearUpNextAtom);

  const total = queueState?.totalCount ?? 0;
  const upNext = queueState?.upNextCount ?? 0;

  if (!queueState || total === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-muted-foreground hover:text-destructive h-8 px-2 text-xs",
            className,
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Clear
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          disabled={upNext === 0}
          onSelect={() => {
            hapticDestructive();
            clearUpNext();
            toast.success(
              upNext === 1
                ? "Cleared 1 track from up next"
                : `Cleared ${upNext} tracks from up next`,
            );
          }}
        >
          Clear up next{upNext > 0 ? ` (${upNext})` : ""}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => {
            hapticDestructive();
            clearQueue();
            toast.success(
              total === 1
                ? "Cleared 1 track from queue"
                : `Cleared ${total} tracks from queue`,
            );
          }}
        >
          Clear all
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
