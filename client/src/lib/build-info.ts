export type BuildInfo = {
  version: string;
  buildDate: string;
  gitCommit: string;
};

export const buildInfo: BuildInfo = __FERROTUNE_BUILD_INFO__;

export function formatBuildDate(buildDate: string) {
  const date = new Date(buildDate);

  if (Number.isNaN(date.getTime())) {
    return buildDate || "unknown";
  }

  return date.toISOString().replace(".000Z", "Z");
}
