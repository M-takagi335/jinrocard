import { card, ROLES, RULES, validDeck, type Role } from './cards.ts'
import type { NamedDeck } from './decks.ts'

type Category = ReturnType<typeof card>['category']
const randomRaidMinimum = 3
type Profile = {
  label: string
  description: string
} & ({ preset: readonly Role[] } | {
  minimums: readonly [Category, number][]
  weights: Partial<Record<Category, number>>
  roleWeights?: Partial<Record<Role, number>>
})

export const PROFILES = {
  balanced: {
    label: 'バランス型', description: '攻撃・防御・情報・回収を幅広く採用',
    minimums: [['attack', 5], ['guard', 4], ['intel', 3], ['supply', 3]],
    weights: { attack: 2, guard: 2 },
  },
  rush: {
    label: '速攻型', description: '人狼・大狼・妖狐を軸に攻める',
    minimums: [['attack', 8], ['guard', 3]],
    weights: { attack: 6, guard: 1.4, supply: .7 },
    roleWeights: { wolf: 2, dire: 2, fox: 2, cat: .6, assassin: .6 },
  },
  defense: {
    label: '耐久型', description: '狩人・騎士・魔女・罠師で守り、反撃する',
    minimums: [['guard', 7], ['attack', 5]],
    weights: { guard: 6, attack: 1.7 },
    roleWeights: { witch: 1.5, trap: 1.3, cat: 2, dire: .6 },
  },
  intel: {
    label: '情報戦型', description: '占い師・預言者・暗殺者を軸にした検証済みの固定構成',
    // 「情報＋暗殺者支援」 in reports/intel-balance-tables.md.
    preset: [
      'wolf','wolf','wolf','assassin','assassin','fox','cat','hunter',
      'knight','knight','witch','witch','trap','trap','seer','seer',
      'prophet','prophet','mad','curse',
    ],
  },
  combo: {
    label: 'コンボ型', description: '霊媒師・墓守・共有者・商人でカードを回す',
    minimums: [['supply', 6], ['attack', 5], ['guard', 3]],
    weights: { supply: 6, attack: 1.5 },
    roleWeights: { medium: 2, keeper: 1.6, mason: 1.5 },
  },
  random: {
    label: '完全ランダム型', description: `全役職から抽選。襲撃カードを最低${randomRaidMinimum}枚採用`,
    minimums: [],
    weights: {},
  },
} satisfies Record<string, Profile>
export type DeckType = keyof typeof PROFILES
export const DECK_TYPES = Object.keys(PROFILES) as DeckType[]
const raidRoles: readonly Role[] = ['wolf', 'dire', 'fox']

export function generateDeck(type: DeckType, rng = Math.random): Role[] {
  if (!Object.hasOwn(PROFILES, type)) throw new Error('デッキタイプが見つかりません。')
  const profile: Profile = PROFILES[type]
  if ('preset' in profile) {
    if (!validDeck(profile.preset)) throw new Error('固定デッキの枚数または投入上限が正しくありません。')
    return [...profile.preset]
  }
  const { weights, roleWeights, minimums } = profile
  const counts = new Map<Role, number>()
  const deck: Role[] = []

  function pick(category?: Category, pool: readonly Role[] = ROLES) {
    const candidates = pool.flatMap(role => {
      const spec = card(role)
      if ((category && spec.category !== category) || (counts.get(role) ?? 0) >= spec.limit) return []
      return [{ role, weight: (weights[spec.category] ?? 1) * (roleWeights?.[role] ?? 1) }]
    })
    const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
    if (total <= 0) throw new Error('投入上限内で必要なカードを揃えられませんでした。')
    const roll = rng()
    if (!(roll >= 0 && roll < 1)) throw new Error('乱数の値が不正です。')
    let threshold = roll * total
    for (const candidate of candidates) {
      threshold -= candidate.weight
      if (threshold >= 0) continue
      deck.push(candidate.role)
      counts.set(candidate.role, (counts.get(candidate.role) ?? 0) + 1)
      return
    }
    throw new Error('カードの抽選に失敗しました。')
  }

  if (type === 'random') {
    for (let index = 0; index < randomRaidMinimum; index++) pick(undefined, raidRoles)
  }
  for (const [category, minimum] of minimums) {
    for (let index = 0; index < minimum; index++) pick(category)
  }
  while (deck.length < RULES.deckSize) pick()
  if (!validDeck(deck)) throw new Error('生成したデッキが枚数または投入上限の条件を満たしていません。')
  return deck
}

const composition = (deck: readonly Role[]) => ROLES.map(role => deck.filter(entry => entry === role).length)
const signature = (counts: number[]) => counts.join(',')
type BatchSize = 1 | 3 | 5 | 10
export type GeneratedDeck = NamedDeck & { type: DeckType }

export function generateDecks(
  types: readonly DeckType[],
  size: BatchSize,
  usedNames: readonly string[] = [],
  previous: readonly GeneratedDeck[] = [],
  rng = Math.random,
): GeneratedDeck[] {
  if (!types.length) throw new Error('デッキタイプを1つ以上選んでください。')
  const names = new Set(usedNames)
  const known = new Set(previous.map(deck => signature(composition(deck.cards))))
  const chosen: number[][] = []
  const generated: GeneratedDeck[] = []

  for (let index = 0; index < size; index++) {
    const type = types[index % types.length]
    const fixedComposition = 'preset' in PROFILES[type]
    let best: { cards: Role[]; counts: number[]; distance: number } | undefined
    for (let attempt = 0; attempt < 24; attempt++) {
      const cards = generateDeck(type, rng)
      const counts = composition(cards)
      if (!fixedComposition && known.has(signature(counts))) continue
      const distance = Math.min(...chosen.map(other =>
        counts.reduce((sum, count, i) => sum + Math.abs(count - other[i]), 0)))
      if (!best || distance > best.distance) best = { cards, counts, distance }
      if (fixedComposition || !chosen.length || distance >= 12) break
    }
    if (!best) throw new Error('異なる構成を生成できませんでした。もう一度お試しください。')
    known.add(signature(best.counts))
    chosen.push(best.counts)
    const prefix = PROFILES[type].label
    let number = 1
    while (names.has(prefix + String(number).padStart(2, '0'))) number++
    const name = prefix + String(number).padStart(2, '0')
    names.add(name)
    generated.push({ type, name, cards: best.cards })
  }
  return generated
}
