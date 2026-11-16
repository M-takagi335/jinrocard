import { useId } from 'react'
import { card, CATEGORY, ROLES, type Role } from './cards.ts'

const silhouettes = [
  'M25 76 32 34 54 48 66 43 78 47 105 29 103 68 109 86 92 106 66 121 44 108 26 88Z',
  'M20 74 26 31 51 53 70 42 88 47 111 24 105 70 114 90 94 111 66 126 42 112Z',
  'M36 91 33 59 47 36 67 19 86 35 101 57 99 90 111 116 24 116Z',
  'M28 82 36 28 59 57 74 56 100 26 105 82 93 102 67 119 46 106Z',
  'M29 86 33 39 55 58 80 59 100 37 106 86 91 110 46 110Z',
  'M53 32 72 30 86 46 88 75 109 115 23 115 46 77 45 51Z',
  'M67 25 104 43 100 79 89 103 67 119 45 104 34 79 30 43Z',
  'M67 22 79 48 107 62 89 69 84 92 104 115 32 115 48 92 43 70 23 64 54 48Z',
  'M24 105 37 46 52 55 48 31 67 26 84 33 82 57 99 46 111 105Z',
  'M25 73Q65 26 109 73Q65 118 25 73Z',
  'M67 18 77 54 111 43 89 69 113 95 80 89 67 123 55 89 20 96 45 70 23 45 56 54Z',
  'M28 108 34 73 43 32 77 25 96 47 105 110 81 102 62 112Z',
  'M35 61 25 36 53 45 68 23 86 51 110 37 100 66 96 100 69 119 39 100Z',
  'M66 22Q91 24 92 57L103 110 79 101 65 119 49 101 31 110 42 58Q41 30 66 22Z',
  'M34 111 34 59Q34 32 67 24Q100 32 100 59L100 111Z',
  'M23 114 25 70 40 50 54 53 67 73 82 49 97 51 110 71 112 114Z',
  'M36 55 56 46 43 28 91 28 78 47 98 56Q124 116 67 118Q10 116 36 55Z',
  'M26 53 53 45 64 22 78 47 109 51 94 73 99 101 67 120 34 100 40 73Z',
  'M67 22 99 42 111 75 94 105 67 119 39 105 23 75 35 44Z',
  'M32 100 23 43 50 63 67 28 84 63 111 43 102 100Z',
]
export function Art({role}:{role:Role}) {
  const uid=useId(), i=ROLES.indexOf(role), spec=card(role)
  const face=i<6||i===7||i===11||i===12||i===13||i===17
  return <svg className="art" viewBox="0 0 134 145" aria-hidden="true">
    <defs><radialGradient id={uid}><stop stopColor="currentColor" stopOpacity=".30"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></radialGradient></defs>
    <rect width="134" height="145" fill={'url(#'+uid+')'}/>
    <g fill="none" stroke="currentColor" opacity=".24"><circle cx="67" cy="73" r="53"/><circle cx="67" cy="73" r="60" strokeDasharray="1 4"/><path d="M67 5 126 73 67 140 8 73Z"/></g>
    <path d="M0 130 23 113 36 122 56 107 81 119 103 105 134 122V145H0Z" fill="currentColor" opacity=".13"/>
    <path d={silhouettes[i]} fill="#17141d" stroke="currentColor" strokeWidth="1.5"/>
    {face ? <g fill="currentColor"><path opacity=".58" d="M41 71 62 78 49 81ZM93 71 72 78 85 81Z"/><path opacity=".37" d="M67 83 74 94 67 99 60 94Z"/></g> : <text x="67" y="89" textAnchor="middle" fill="currentColor" fontSize="30" fontFamily="serif">{spec.icon}</text>}
    <path d="M12 21h10M17 16v10M109 117h10M114 112v10" stroke="currentColor" opacity=".6"/>
  </svg>
}
export function CardTile({role,selected=false,disabled=false,onClick,detail,glowing=false}:{role:Role;selected?:boolean;disabled?:boolean;onClick?:()=>void;detail?:string;glowing?:boolean}) {
  const spec=card(role)
  const body=<><span className="card-type">{CATEGORY[spec.category]}</span><Art role={role}/><span className="card-name">{spec.name}</span><span className="card-text">{spec.text}</span>{detail&&<span className="card-detail">{detail}</span>}</>
  const className='card '+spec.category+(selected?' selected':'')+(disabled?' inactive':'')+(glowing?' insight-glow':'')
  return onClick ? <button type="button" className={className} onClick={onClick} aria-pressed={selected}>{body}</button>:<div className={className}>{body}</div>
}
