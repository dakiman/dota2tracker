import type { Role } from './types.js'

const CDN_BASE =
  'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react'

export function heroImageUrl(slug: string): string {
  return `${CDN_BASE}/heroes/${slug}.png`
}

export function heroCropUrl(slug: string): string {
  return `${CDN_BASE}/heroes/crops/${slug}.png`
}

export function abilityImageUrl(abilityName: string): string {
  return `${CDN_BASE}/abilities/${abilityName}.png`
}

export function itemImageUrl(itemName: string): string {
  return `${CDN_BASE}/items/${itemName}.png`
}

/** Format an internal item key (e.g. "black_king_bar") into a display name ("Black King Bar") */
export function formatItemName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** OpenDota hero name (e.g. npc_dota_hero_crystal_maiden) -> slug (crystal_maiden) */
export function heroNameToSlug(name: string): string {
  return name.replace(/^npc_dota_hero_/, '')
}

/**
 * Static hero_id -> primary role mapping based on actual Dota 2 hero positions.
 * IDs verified against OpenDota API data.
 * Heroes not in this map fall back to DEFAULT_ROLE ('support').
 */
export const HERO_ROLE_MAP: Record<number, Role> = {
  1: 'carry',    // Anti-Mage
  2: 'offlane',  // Axe
  3: 'support',  // Bane
  4: 'carry',    // Bloodseeker
  5: 'support',  // Crystal Maiden
  6: 'carry',    // Drow Ranger
  7: 'support',  // Earthshaker
  8: 'carry',    // Juggernaut
  9: 'support',  // Mirana
  10: 'carry',   // Morphling
  11: 'mid',     // Shadow Fiend
  12: 'carry',   // Phantom Lancer
  13: 'mid',     // Puck
  14: 'support', // Pudge
  15: 'carry',   // Razor
  16: 'offlane', // Sand King
  17: 'mid',     // Storm Spirit
  18: 'carry',   // Sven
  19: 'offlane', // Tiny
  20: 'support', // Vengeful Spirit
  21: 'mid',     // Windranger
  22: 'mid',     // Zeus
  23: 'offlane', // Kunkka
  25: 'mid',     // Lina
  26: 'support', // Lion
  27: 'support', // Shadow Shaman
  28: 'offlane', // Slardar
  29: 'offlane', // Tidehunter
  30: 'support', // Witch Doctor
  31: 'support', // Lich
  32: 'carry',   // Riki
  33: 'offlane', // Enigma
  34: 'mid',     // Tinker
  35: 'carry',   // Sniper
  36: 'mid',     // Necrophos
  37: 'support', // Warlock
  38: 'offlane', // Beastmaster
  39: 'mid',     // Queen of Pain
  40: 'offlane', // Venomancer
  41: 'carry',   // Faceless Void
  42: 'carry',   // Wraith King
  43: 'mid',     // Death Prophet
  44: 'carry',   // Phantom Assassin
  45: 'mid',     // Pugna
  46: 'mid',     // Templar Assassin
  47: 'mid',     // Viper
  48: 'carry',   // Luna
  49: 'offlane', // Dragon Knight
  50: 'support', // Dazzle
  51: 'offlane', // Clockwerk
  52: 'mid',     // Leshrac
  53: 'offlane', // Nature's Prophet
  54: 'carry',   // Lifestealer
  55: 'offlane', // Dark Seer
  56: 'carry',   // Clinkz
  57: 'support', // Omniknight
  58: 'support', // Enchantress
  59: 'offlane', // Huskar
  60: 'offlane', // Night Stalker
  61: 'offlane', // Broodmother
  62: 'support', // Bounty Hunter
  63: 'carry',   // Weaver
  64: 'support', // Jakiro
  65: 'offlane', // Batrider
  66: 'support', // Chen
  67: 'carry',   // Spectre
  68: 'support', // Ancient Apparition
  69: 'offlane', // Doom
  70: 'carry',   // Ursa
  71: 'offlane', // Spirit Breaker
  72: 'carry',   // Gyrocopter
  73: 'carry',   // Alchemist
  74: 'mid',     // Invoker
  75: 'support', // Silencer
  76: 'mid',     // Outworld Destroyer
  77: 'offlane', // Lycan
  78: 'offlane', // Brewmaster
  79: 'support', // Shadow Demon
  80: 'carry',   // Lone Druid
  81: 'carry',   // Chaos Knight
  82: 'mid',     // Meepo
  83: 'support', // Treant Protector
  84: 'support', // Ogre Magi
  85: 'offlane', // Undying
  86: 'support', // Rubick
  87: 'support', // Disruptor
  88: 'support', // Nyx Assassin
  89: 'carry',   // Naga Siren
  90: 'support', // Keeper of the Light
  91: 'support', // Io
  92: 'offlane', // Visage
  93: 'carry',   // Slark
  94: 'carry',   // Medusa
  95: 'carry',   // Troll Warlord
  96: 'offlane', // Centaur Warrunner
  97: 'offlane', // Magnus
  98: 'offlane', // Timbersaw
  99: 'offlane', // Bristleback
  100: 'support',// Tusk
  101: 'support',// Skywrath Mage
  102: 'support',// Abaddon
  103: 'support',// Elder Titan
  104: 'offlane',// Legion Commander
  105: 'support',// Techies
  106: 'mid',    // Ember Spirit
  107: 'support',// Earth Spirit
  108: 'offlane',// Underlord
  109: 'carry',  // Terrorblade
  110: 'offlane',// Phoenix
  111: 'support',// Oracle
  112: 'support',// Winter Wyvern
  113: 'carry',  // Arc Warden
  114: 'carry',  // Monkey King
  119: 'support',// Dark Willow
  120: 'mid',    // Pangolier
  121: 'support',// Grimstroke
  123: 'support',// Hoodwink
  126: 'mid',    // Void Spirit
  128: 'support',// Snapfire
  129: 'offlane',// Mars
  131: 'support',// Ringmaster
  135: 'offlane',// Dawnbreaker
  136: 'support',// Marci
  137: 'offlane',// Primal Beast
  138: 'carry',  // Muerta
  145: 'carry',  // Kez
}

/** Default role when hero not in map */
export const DEFAULT_ROLE: Role = 'support'

export function getHeroRole(heroId: number): Role {
  return HERO_ROLE_MAP[heroId] ?? DEFAULT_ROLE
}

const SUPPORT_ROLES: ReadonlySet<Role> = new Set(['support', 'hard_support'])

/**
 * Derive the role actually played in a match from OpenDota lane data.
 * lane_role: 1 = safe lane, 2 = mid, 3 = offlane, 4 = jungle; null until the
 * match is parsed. HERO_ROLE_MAP decides support vs core within a lane and is
 * the fallback for unparsed matches.
 */
export function deriveRole(
  laneRole: number | null | undefined,
  isRoaming: boolean | null | undefined,
  heroId: number
): Role {
  const supportFlavored = SUPPORT_ROLES.has(getHeroRole(heroId))
  if (isRoaming) return 'support'
  switch (laneRole) {
    case 1:
      return supportFlavored ? 'hard_support' : 'carry'
    case 2:
      return 'mid'
    case 3:
    case 4:
      return supportFlavored ? 'support' : 'offlane'
    default:
      return getHeroRole(heroId)
  }
}
