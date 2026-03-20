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
  pickRate?: number
  role: Role
  playerId?: string
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

/** Hero detail page payload */
export interface HeroBuild {
  heroId: number
  heroName: string
  heroSlug: string
  totalMatches: number
  winRate: number
  roleTabs: RoleTabStat[]
  skillBuilds: SkillBuild[]
  itemBuild: ItemBuild
  stats?: StatsData
}
