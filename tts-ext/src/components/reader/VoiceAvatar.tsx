type Portrait = { backdrop: string; skin: string; hair: string; shirt: string; style: 'bob' | 'waves' | 'crop' | 'curls' | 'buns' | 'bald'; glasses?: boolean; beard?: boolean };
const portraits: Record<string, Portrait> = {
  af_sarah: { backdrop: '#e6cfb5', skin: '#eab899', hair: '#80482e', shirt: '#546d55', style: 'waves' },
  af_alloy: { backdrop: '#c5d0e4', skin: '#bb8164', hair: '#30272d', shirt: '#586487', style: 'curls' },
  af_nicole: { backdrop: '#ddcadd', skin: '#edc4ac', hair: '#393035', shirt: '#78647b', style: 'bob' },
  am_adam: { backdrop: '#cbd8b9', skin: '#d9a37d', hair: '#574133', shirt: '#64714c', style: 'crop', beard: true },
  am_michael: { backdrop: '#c4d9de', skin: '#b97e5c', hair: '#302d29', shirt: '#536e7b', style: 'crop' },
  am_onyx: { backdrop: '#e1cfb3', skin: '#8e6049', hair: '#352d29', shirt: '#7c694e', style: 'bald', beard: true },
  bf_alice: { backdrop: '#d7cfe6', skin: '#efc5af', hair: '#a5633d', shirt: '#726188', style: 'waves', glasses: true },
  bf_lily: { backdrop: '#d6dfbb', skin: '#d7a682', hair: '#35332e', shirt: '#6c7855', style: 'buns' },
  bm_fable: { backdrop: '#c5dcd5', skin: '#c99576', hair: '#685047', shirt: '#51796d', style: 'curls', glasses: true },
  'mac:macos-start-speaking': { backdrop: '#d3d9d0', skin: '#d8b99e', hair: '#74766d', shirt: '#637469', style: 'bob', glasses: true },
};

/** Original, illustrative portraits; each voice has a stable mark at every size. */
export function VoiceAvatar({ voice, size = 32 }: { voice: string; size?: number }) {
  const p = portraits[voice] ?? portraits.af_sarah;
  const longHair = ['bob', 'waves', 'buns'].includes(p.style);
  return <svg className="reader-avatar" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="24" fill={p.backdrop} />
    {longHair && <path d="M12 21c0-11 5-15 12-15s12 4 12 15v16H12Z" fill={p.hair} />}
    {p.style === 'buns' && <g fill={p.hair}><circle cx="13" cy="11" r="6" /><circle cx="35" cy="11" r="6" /></g>}
    <path d="M5 48c1-10 8-13 19-13s18 3 19 13" fill={p.shirt} />
    <path d="M19 29h10v9c-3 3-7 3-10 0Z" fill={p.skin} />
    <ellipse cx="24" cy="21" rx="11" ry="13" fill={p.skin} />
    {p.style === 'bob' && <path d="M12 23V17C12 9 17 6 24 6s12 4 12 12v6l-4-6-2-5c-4 4-8 5-15 5l-2 8Z" fill={p.hair} />}
    {p.style === 'waves' && <path d="M12 24V18c0-8 5-12 12-12 8 0 12 5 12 13l-2 9-3-12c-5 1-8-1-9-5-1 5-4 7-8 8l1 10Z" fill={p.hair} />}
    {p.style === 'crop' && <path d="M13 22v-8c0-6 5-9 12-9 6 0 10 3 10 9v7l-3-8c-6 3-11 3-16 1Z" fill={p.hair} />}
    {p.style === 'curls' && <g fill={p.hair}><circle cx="15" cy="14" r="5" /><circle cx="19" cy="9" r="5" /><circle cx="26" cy="8" r="5" /><circle cx="32" cy="12" r="5" /><circle cx="34" cy="17" r="4" /></g>}
    {p.style === 'buns' && <path d="M13 19c-1-9 5-13 11-13s12 4 11 13c-5-1-8-3-11-7-3 4-6 6-11 7" fill={p.hair} />}
    {p.beard && <path d="M14 24c3 3 4 5 10 5s8-2 10-5c-1 8-5 11-10 11s-9-3-10-11" fill={p.hair} />}
    <g fill="#302f2a"><circle cx="20" cy="22" r="1.1" /><circle cx="28" cy="22" r="1.1" /></g>
    {p.glasses && <g fill="none" stroke={p.hair} strokeWidth="1.4"><rect x="15.5" y="18.5" width="8" height="6.5" rx="2.5" /><rect x="24.5" y="18.5" width="8" height="6.5" rx="2.5" /><path d="M23.5 21h1" /></g>}
    <path d="M21 28c2 1.5 4 1.5 6 0" fill="none" stroke={p.beard ? p.skin : '#9d604e'} strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}
