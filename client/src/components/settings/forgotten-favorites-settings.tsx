import { useAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invalidateForgottenFavoritesQueries } from "@/lib/api/cache-invalidation";
import { forgottenFavoritesSettingsAtom } from "@/lib/store/ui";
import { flushPendingWrites } from "@/lib/store/server-storage";

const numberFromInput = (value: string) => Math.max(1, Number(value) || 1);

/**
 * Which songs count as forgotten favorites. The server reads this one setting
 * for the Home row, its section page, tiles, and queues on every client.
 */
export function ForgottenFavoritesSettings() {
  const [settings, setSettings] = useAtom(forgottenFavoritesSettingsAtom);
  const queryClient = useQueryClient();

  // The preference write is debounced; lists refetch once the server has it.
  const save = async () => {
    await flushPendingWrites();
    invalidateForgottenFavoritesQueries(queryClient);
  };

  return (
    <div
      className="space-y-3 rounded-lg bg-muted/30 p-3"
      data-testid="forgotten-favorites-settings"
    >
      <div className="flex items-center gap-2 font-medium">
        <History className="h-4 w-4 text-amber-500" />
        Forgotten Favorites
      </div>
      <p className="text-sm text-muted-foreground">
        Songs you played often but haven&apos;t heard in a while. Applies to the
        Home row, its page, tiles, and queues.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="forgotten-min-plays">Minimum plays</Label>
          <Input
            id="forgotten-min-plays"
            type="number"
            min={1}
            value={settings.minPlays}
            onChange={(event) =>
              setSettings({
                ...settings,
                minPlays: numberFromInput(event.target.value),
              })
            }
            onBlur={save}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="forgotten-not-played-days">Not played for days</Label>
          <Input
            id="forgotten-not-played-days"
            type="number"
            min={1}
            value={settings.notPlayedSinceDays}
            onChange={(event) =>
              setSettings({
                ...settings,
                notPlayedSinceDays: numberFromInput(event.target.value),
              })
            }
            onBlur={save}
          />
        </div>
      </div>
    </div>
  );
}
