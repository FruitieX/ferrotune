"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHasFinePointer } from "@/lib/hooks/use-media-query";

interface MoveToPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPosition: number;
  totalCount: number;
  itemName: string;
  onMove: (newPosition: number) => void;
}

export function MoveToPositionDialog({
  open,
  onOpenChange,
  currentPosition,
  totalCount,
  itemName,
  onMove,
}: MoveToPositionDialogProps) {
  const hasFinePointer = useHasFinePointer();

  // Use 1-based position for user display (more intuitive)
  const [inputValue, setInputValue] = useState(String(currentPosition + 1));
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset input when dialog opens (React-recommended pattern for adjusting state when props change)
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setInputValue(String(currentPosition + 1));
      setError(null);
    }
  }

  const handleMove = () => {
    const newPosition = parseInt(inputValue, 10);

    // Validate
    if (isNaN(newPosition) || newPosition < 1 || newPosition > totalCount) {
      setError(`Position must be between 1 and ${totalCount}`);
      return;
    }

    // Convert back to 0-based index
    const newIndex = newPosition - 1;

    if (newIndex === currentPosition) {
      onOpenChange(false);
      return;
    }

    onMove(newIndex);
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleMove();
    }
  };

  const formContent = (
    <div className="space-y-4 py-4 px-4">
      <div className="space-y-2">
        <Label htmlFor="position">Position (1-{totalCount})</Label>
        <Input
          id="position"
          type="number"
          min={1}
          max={totalCount}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Current: ${currentPosition + 1}`}
          autoFocus={hasFinePointer}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="text-sm text-muted-foreground">
        Current position: {currentPosition + 1} of {totalCount}
      </div>
    </div>
  );

  // Mobile: use Drawer instead of Dialog to avoid Radix portal/overlay leak
  // that blocks interactions after the dialog is dismissed in Android WebView.
  if (!hasFinePointer) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Move to Position</DrawerTitle>
            <DrawerDescription>
              Move &quot;{itemName}&quot; to a new position.
            </DrawerDescription>
          </DrawerHeader>

          {formContent}

          <DrawerFooter>
            <Button onClick={handleMove}>Move</Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md z-[70]" overlayClassName="z-[70]">
        <DialogHeader>
          <DialogTitle>Move to Position</DialogTitle>
          <DialogDescription>
            Move &quot;{itemName}&quot; to a new position.
          </DialogDescription>
        </DialogHeader>

        {formContent}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
