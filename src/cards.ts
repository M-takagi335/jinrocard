export const RULES = { hp: 20, deckSize: 20, opening: 5, nightlyDraw: 1, handRefill: 2, handLimit: 7, maxPlays: 2, finalNight: 15, finalTieBreak: 'hp' } as const
type Category = 'attack' | 'guard' | 'intel' | 'supply' | 'hex'
type Spec = { name: string; category: Category; limit: number; icon: string; text: string; power?: number; lowHp?: number; boosted?: number; recoil?: number }
const CARD_DEFINITIONS = {
  wolf: { name:'人狼', category:'attack', limit:3, icon:'狼', power:3, text:'相手に襲撃で3ダメージ。' },
  dire: { name:'大狼', category:'attack', limit:2, icon:'牙', power:5, recoil:2, text:'相手に襲撃で5ダメージ。自分に2ダメージ。' },
  assassin: { name:'暗殺者', category:'attack', limit:2, icon:'刃', power:4, text:'相手が出す役職を1種類予想。的中すれば特殊攻撃で4ダメージ。' },
  fox: { name:'妖狐', category:'attack', limit:2, icon:'狐', power:2, lowHp:10, boosted:4, text:'襲撃で2ダメージ。攻撃開始時に自分のHPが10以下なら4ダメージ。' },
  cat: { name:'猫又', category:'attack', limit:2, icon:'猫', power:3, text:'相手の攻撃でHPダメージを受けたとき、特殊攻撃で3ダメージを返す。' },
  hunter: { name:'狩人', category:'guard', limit:3, icon:'弓', text:'相手からの襲撃をすべて無効化。' },
  knight: { name:'騎士', category:'guard', limit:2, icon:'盾', power:2, text:'相手からのダメージを合計2軽減。特殊攻撃にも有効。' },
  witch: { name:'魔女', category:'guard', limit:2, icon:'薬', power:4, text:'HPを4回復。攻撃後にHPが0なら回復できない。' },
  trap: { name:'罠師', category:'guard', limit:2, icon:'罠', power:2, text:'相手が襲撃した場合、襲撃を無効化し、特殊攻撃で2ダメージを返す。' },
  seer: { name:'占い師', category:'intel', limit:2, icon:'瞳', power:1, text:'相手の残り手札からランダムに1枚を自分だけが確認。' },
  prophet: { name:'預言者', category:'intel', limit:2, icon:'星', power:3, text:'相手の山札の上から最大3枚、自分だけが確認。順序は変わらない。' },
  spy: { name:'密偵', category:'intel', limit:2, icon:'影', power:1, text:'相手が攻撃カードを出していれば1枚引く。' },
  jester: { name:'道化師', category:'intel', limit:2, icon:'戯', power:2, text:'相手が攻撃カードを出していなければ2枚引く。' },
  medium: { name:'霊媒師', category:'supply', limit:2, icon:'魂', text:'自分の捨て札から1枚選び、手札に戻す。' },
  keeper: { name:'墓守', category:'supply', limit:2, icon:'墓', text:'自分の捨て札から1枚選び、山札の一番上に戻す。' },
  mason: { name:'共有者', category:'supply', limit:2, icon:'絆', power:2, text:'カードを2枚引き、手札から1枚選んで捨てる。' },
  merchant: { name:'商人', category:'supply', limit:2, icon:'貨', power:3, recoil:2, text:'HPを2失い、3枚引く。HPが0になると敗北。' },
  mad: { name:'狂人', category:'hex', limit:2, icon:'乱', text:'相手が2枚出した場合、そのうちランダムに1枚の効果を無効化。' },
  curse: { name:'呪術師', category:'hex', limit:2, icon:'呪', text:'相手の次の夜のHP回復を無効化。' },
  tyrant: { name:'独裁者', category:'hex', limit:1, icon:'冠', text:'相手が次の夜に出せるカードを最大1枚に制限。' },
} satisfies Record<string, Spec>
export type Role = keyof typeof CARD_DEFINITIONS
type CardData = Spec & { imagePath: string }
export const CARDS = Object.fromEntries(
  Object.entries(CARD_DEFINITIONS).map(([id, spec]) => [
    id, { ...spec, imagePath: 'cards/' + encodeURIComponent(spec.name) + '.jpg' },
  ]),
) as Record<Role, CardData>
export const ROLES = Object.keys(CARDS) as Role[]
export const card = (role: Role) => CARDS[role]
export const CATEGORY = { attack:'攻撃', guard:'防御・回復', intel:'情報・心理戦', supply:'回収・ドロー', hex:'妨害' }
export const STARTER: Role[] = ['wolf','wolf','wolf','dire','assassin','fox','cat','hunter','hunter','knight','witch','witch','trap','seer','spy','medium','mason','mad','curse','tyrant']
export const NPC_DECK: Role[] = ['wolf','wolf','dire','dire','fox','fox','assassin','cat','hunter','hunter','knight','witch','witch','trap','prophet','jester','keeper','merchant','mad','curse']
export function validDeck(roles: readonly unknown[], size: number = RULES.deckSize) {
  if (roles.length !== size) return false
  const counts = new Map<Role, number>()
  for (let index = 0; index < size; index++) {
    if (!Object.hasOwn(roles, index)) return false
    const role = roles[index]
    if (typeof role !== 'string' || !Object.hasOwn(CARDS, role)) return false
    const id = role as Role
    const count = (counts.get(id) ?? 0) + 1
    if (count > card(id).limit) return false
    counts.set(id, count)
  }
  return true
}
