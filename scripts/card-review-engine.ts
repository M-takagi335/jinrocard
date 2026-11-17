import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import type * as engine from '../src/duel.ts'
import type * as strong from '../src/strongNpc.ts'

export type Variant = 'current' | 'merchant-hp1' | 'merchant-draw4' | 'keeper-hand' | 'keeper-top-draw'
export const variants: readonly Variant[] = ['current', 'merchant-hp1', 'merchant-draw4', 'keeper-hand', 'keeper-top-draw']

function replace(source: string, before: string, after: string) {
  assert.equal(source.split(before).length, 2, 'Engine anchor: ' + before)
  return source.replace(before, after)
}
function source(file: string, imports: Record<string, string> = {}) {
  const url = new URL('../src/' + file, import.meta.url)
  return readFileSync(url, 'utf8').replace(/from '(\.\/[^']+)'/g, (_, path: string) =>
    "from '" + (imports[path] ?? new URL(path, url).href) + "'")
}
function moduleUrl(code: string) {
  return 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(code, { mode: 'strip' })).toString('base64')
}

export async function reviewEngine(variant: Variant) {
  const imports: Record<string, string> = {}
  if (variant.startsWith('merchant')) {
    const cards = source('cards.ts')
    const result = replace(cards, "icon:'貨', power:3, recoil:2",
      variant === 'merchant-hp1' ? "icon:'貨', power:3, recoil:1" : "icon:'貨', power:4, recoil:2")
    imports['./cards.ts'] = moduleUrl(result)
  }
  let policy = source('strongNpc.ts', imports)
  let duel = source('duel.ts', imports)
  if (variant === 'merchant-hp1') {
    policy = replace(policy, "case 'merchant': return hp <= 2", "case 'merchant': return hp <= 1")
    duel = replace(duel, "case 'merchant': return hp<=2", "case 'merchant': return hp<=1")
  }
  if (variant === 'keeper-hand' || variant === 'keeper-top-draw') {
    policy = replace(policy, "case 'keeper': if (hasDiscard) result.future += .55; break",
      "case 'keeper': if (hasDiscard) result.supplies += 1; break")
  }
  imports['./strongNpc.ts'] = moduleUrl(policy)
  duel = duel.replace(/from '([^']*\/strongNpc\.ts)'/, "from '" + imports['./strongNpc.ts'] + "'")
  // Add observations without altering mechanics, random sampling or the information passed to policies.
  duel = replace(duel, "const count=(i:Side,r:Role)=>active[i].filter(c=>c.role===r).length",
    `const count=(i:Side,r:Role)=>active[i].filter(c=>c.role===r).length
    const audit=(i:Side,r:Role,n=1)=>{ for(const c of active[i]) if(c.role===r) this.write('@effect:'+c.id+':'+n) }
    for(const i of sides) if(this.revealed[other(i)].length===2)
      for(const c of this.revealed[i]) if(c.role==='mad') this.write('@effect:'+c.id+':1')`)
  duel = replace(duel, "this.updateProphet(side, 'draw')", "this.updateProphet(side, 'draw'); this.write('@draw:'+c.id)")
  duel = replace(duel, "if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。')",
    "if(kind==='refill') this.write(who[side]+'は夜終了時に手札を'+drawn+'枚補充した。'); return drawn")
  duel = replace(duel, "if(reduction) this.write(", "if(reduction) { audit(target,'knight',reduction); this.write(")
  duel = replace(duel, "'ダメージ軽減した。')", "'ダメージ軽減した。') }")
  duel = replace(duel, 'if(success) special+=spec.power!', "if(success) { special+=spec.power!; this.write('@effect:'+c.id+':1') }")
  duel = replace(duel, "returns[i]+=count(target,'trap')", "audit(target,'trap'); returns[i]+=count(target,'trap')")
  duel = replace(duel, "this.write(who[target]+'の狩人", "audit(target,'hunter'); this.write(who[target]+'の狩人")
  duel = replace(duel, "dmg[target]=hit(target,raid+special)", `if(raid>shield[target]) for(const role of ['wolf','dire','fox'] as const) audit(i,role)
      dmg[target]=hit(target,raid+special)`)
  duel = replace(duel, "this.write(who[i]+'の猫又", "audit(i,'cat'); this.write(who[i]+'の猫又")
  duel = replace(duel, "if(p.status.noHeal || (!this.legacyCurse && count(other(i),'curse'))) this.write(who[i]+'の回復は呪術師に無効化された。')",
    "if(p.status.noHeal || (!this.legacyCurse && count(other(i),'curse'))) { if(p.hp<this.rules.hp) audit(other(i),'curse'); this.write(who[i]+'の回復は呪術師に無効化された。') }")
  duel = replace(duel, "this.write(who[i]+'はHPを'+gained", "if(gained) audit(i,'witch',gained); this.write(who[i]+'はHPを'+gained")
  duel = replace(duel, "const names = cards.map", "if(cards.length) { this.write('@effect:'+c.id+':'+cards.length); if(c.role==='prophet') this.write('@prophet:'+i+':'+c.id+':'+cards.map(entry=>entry.id).join(',')) }; const names = cards.map")
  duel = replace(duel, "if(attacks===(c.role==='spy')) this.draw(i,spec.power!)",
    "if(attacks===(c.role==='spy')) { const n=this.draw(i,spec.power!); if(n) this.write('@effect:'+c.id+':'+n) }")
  duel = replace(duel, "case 'merchant': this.draw(i,spec.power!); break",
    "case 'merchant': { const n=this.draw(i,spec.power!); if(n) this.write('@effect:'+c.id+':'+n); break }")
  duel = replace(duel, "case 'mason': this.draw(i,spec.power!); yield* this.discardOne(i,'共有者：捨てるカードを選択'); break",
    "case 'mason': { const n=this.draw(i,spec.power!); if(n) this.write('@effect:'+c.id+':'+n); yield* this.discardOne(i,'共有者：捨てるカードを選択'); break }")
  duel = replace(duel, "if (c.role === 'medium') {",
    "this.write('@effect:'+c.id+':1'); if (c.role === 'medium'" + (variant === 'keeper-hand' ? " || c.role === 'keeper'" : '') + ") {")
  if (variant === 'keeper-top-draw')
    duel = replace(duel, "this.updateProphet(i, 'insert')", "this.updateProphet(i, 'insert'); this.draw(i,1)")
  const duelModule = await import(moduleUrl(duel)) as typeof engine
  const strongModule = await import(imports['./strongNpc.ts']) as typeof strong
  return { ...duelModule, ...strongModule }
}
