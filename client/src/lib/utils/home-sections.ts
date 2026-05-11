export const homeSectionHrefs = {
  continueListening: "/home/continue-listening",
  mostPlayedRecently: "/home/most-played-recently",
  recentlyAdded: "/home/recently-added",
  forgottenFavorites: "/home/forgotten-favorites",
  discover: "/home/discover",
};

export function getMostPlayedRecentlyFilters() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  return { since: since.toISOString() };
}
