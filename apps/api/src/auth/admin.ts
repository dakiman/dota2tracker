/** steam64 ids granted admin — comma-separated env allowlist, same shape as
 *  ALLOWED_ORIGINS. Read at call time; default empty (nobody is admin). */
export function adminSteamIds(): string[] {
  return (process.env.ADMIN_STEAM_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}
