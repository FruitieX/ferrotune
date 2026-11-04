/**
 * The server's queue move rule (`drop_target` in `src/api/queue.rs`), used
 * for optimistic updates. The queue reads history, the current track, up next
 * (the block right after it), then the rest of the source list.
 *
 * `toPosition` is the moved row's index after the move. A row that lands
 * anywhere from right after the current track to right after the last
 * up-next song joins up next; anywhere else it's a source row. The playing
 * track moves within the source list and up next stays right after it.
 */
export function queueMoveResult(
  fromPosition: number,
  toPosition: number,
  currentIndex: number,
  upNextCount: number,
): { currentIndex: number; upNextCount: number; landsInUpNext: boolean } {
  if (fromPosition === currentIndex) {
    return {
      currentIndex:
        toPosition <= currentIndex
          ? toPosition
          : Math.max(currentIndex, toPosition - upNextCount),
      upNextCount,
      landsInUpNext: false,
    };
  }
  const fromUpNext =
    fromPosition > currentIndex && fromPosition <= currentIndex + upNextCount;
  const currentWithout = currentIndex - (fromPosition < currentIndex ? 1 : 0);
  const upNextWithout = upNextCount - (fromUpNext ? 1 : 0);
  const landsInUpNext =
    toPosition > currentWithout &&
    toPosition <= currentWithout + 1 + upNextWithout;
  return {
    currentIndex:
      !landsInUpNext && toPosition <= currentWithout
        ? currentWithout + 1
        : currentWithout,
    upNextCount: upNextWithout + (landsInUpNext ? 1 : 0),
    landsInUpNext,
  };
}
