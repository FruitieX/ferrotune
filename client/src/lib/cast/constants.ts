export const CAST_CLIENT_NAME = "ferrotune-cast";

export function isCastClientName(
  clientName: string | null | undefined,
): boolean {
  return clientName === CAST_CLIENT_NAME;
}
