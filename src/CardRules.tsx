import { createContext, useContext } from 'react'
import { card, CARD_SUMMARY, type Role } from './cards.ts'

export const LegacyTrapRules = createContext(false)
export function useRuleCards() {
  const legacy = useContext(LegacyTrapRules)
  return {
    card: (role: Role) => role === 'trap' && legacy ? { ...card(role), text: '相手が襲撃した場合、襲撃を無効化し、特殊攻撃で2ダメージを返す。' } : card(role),
    summary: (role: Role) => role === 'trap' && legacy ? '襲撃を防ぎ特殊2で反撃' : CARD_SUMMARY[role],
  }
}
