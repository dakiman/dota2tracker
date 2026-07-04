export type Role =
  | 'carry'
  | 'mid'
  | 'offlane'
  | 'support'
  | 'hard_support'

export interface Player {
  id: string
  name: string
  avatar?: string
}

export interface AppConfig {
  players: Player[]
  siteName: string
  /** ISO timestamp of the last successful fetch-data run, null if never */
  lastRefreshed: string | null
}

/** Meta page: per-player-per-hero (or aggregated when multiple players selected) */
export interface HeroStat {
  heroId: number
  heroName: string
  heroSlug: string
  matches: number
  wins: number
  winRate: number
  kda: string
  role: Role
}

/** Hero detail: role tab summary */
export interface RoleTabStat {
  role: Role
  matches: number
  winRate: number
}

/** Single ability level choice (e.g. level 1 = "frost_nova") */
export interface SkillBuild {
  levels: string[] // [0..9] ability names
  talents: TalentChoice[]
}

export interface TalentChoice {
  level: 10 | 15 | 20 | 25
  left: string
  right: string
  picked: 'left' | 'right'
  winRate: number
}

export interface ItemGroup {
  items: string[]
  matches: number
  winRate: number
}

export interface SituationalItem {
  itemName: string
  itemImage: string
  purchaseRate: number
  avgMinute: number
}

export interface NeutralItem {
  name: string
  image: string
  pickRate: number
  winRate: number
  isBest?: boolean
}

export interface NeutralTierGroup {
  tier: 1 | 2 | 3 | 4 | 5
  items: NeutralItem[]
}

export interface ItemBuild {
  startingItems: ItemGroup[]
  coreItems: ItemGroup[]
  situationalItems: SituationalItem[]
  neutralItems: NeutralTierGroup[]
  lateGameInventories: Array<{ bracket: string; items: string[] }>
}

export interface LaneStats {
  lane: string
  advantagePct: number
  wins: number
  draws: number
  losses: number
}

export interface MatchDurationWinRate {
  bracket: string
  winRate: number
  matches: number
}

export interface PickPhaseStat {
  phase: string
  winRate: number
  matches: number
}

export interface StatsData {
  laneStats?: LaneStats[]
  radiantWinRate?: number
  direWinRate?: number
  networthAt10?: number
  networthAt15?: number
  networthAt20?: number
  pickPhases?: PickPhaseStat[]
  matchDurationWinRate?: MatchDurationWinRate[]
}

export interface BuildData {
  skillBuilds: SkillBuild[]
  itemBuild: ItemBuild
}

/** One selectable build (skills + items + detailed stats) for a single role. */
export interface RoleBuild {
  role: Role
  /** Player the build belongs to; null = global/curated build */
  playerId: string | null
  skillBuilds: SkillBuild[]
  itemBuild: ItemBuild
  stats?: StatsData
}

/** Hero detail page payload */
export interface HeroBuild {
  heroId: number
  heroName: string
  heroSlug: string
  totalMatches: number
  winRate: number
  /** Exact win count (avoids client-side rounding of totalMatches * winRate) */
  wins: number
  kills?: number
  deaths?: number
  assists?: number
  /** Per-role match summaries (from player_matches); drive the role tabs */
  roleTabs: RoleTabStat[]
  /** Build content per role that has any; role tabs switch between these */
  builds: RoleBuild[]
}

/** Feed: one tracked player's line inside a match card */
export interface MatchParticipant {
  playerId: string
  playerName: string
  avatar: string | null
  heroId: number
  heroName: string
  heroSlug: string
  won: boolean
  kills: number
  deaths: number
  assists: number
  role: Role
}

/** Feed: one match card — party games have several participants */
export interface MatchFeedEntry {
  matchId: number
  /** ISO 8601 */
  startTime: string
  /** seconds */
  duration: number
  participants: MatchParticipant[]
}

export interface MatchesResponse {
  matches: MatchFeedEntry[]
  /** Epoch-seconds cursor for the next page, null when this page wasn't full */
  nextBefore: number | null
}
