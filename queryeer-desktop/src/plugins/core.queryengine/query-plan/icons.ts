const fallbackIcon = icon(`
  <rect x="5" y="5" width="22" height="22" rx="5" fill="#334155" stroke="#94a3b8" stroke-width="2"/>
  <path d="M10 16h12M16 10v12" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round"/>
`);

const operatorIcons: Array<{ pattern: RegExp; iconUrl: string }> = [
  { pattern: /select|statement/i, iconUrl: icon(`<path d="M7 8h18v16H7z" fill="#0f766e" stroke="#5eead4" stroke-width="2"/><path d="M11 13h10M11 18h7" stroke="#ccfbf1" stroke-width="2" stroke-linecap="round"/>`) },
  { pattern: /index seek|table seek|seek/i, iconUrl: icon(`<circle cx="14" cy="14" r="7" fill="#7c3aed" stroke="#c4b5fd" stroke-width="2"/><path d="M19 19l6 6" stroke="#ddd6fe" stroke-width="3" stroke-linecap="round"/><path d="M11 14h6" stroke="#f5f3ff" stroke-width="2" stroke-linecap="round"/>`) },
  { pattern: /index scan|table scan|scan/i, iconUrl: icon(`<rect x="6" y="7" width="20" height="18" rx="3" fill="#0369a1" stroke="#7dd3fc" stroke-width="2"/><path d="M10 12h12M10 17h12M10 22h7" stroke="#e0f2fe" stroke-width="2" stroke-linecap="round"/>`) },
  { pattern: /nested loops|merge join|hash match|join/i, iconUrl: icon(`<path d="M7 10h7c5 0 5 12 10 12h1" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/><path d="M7 22h7c5 0 5-12 10-12h1" fill="none" stroke="#fde68a" stroke-width="3" stroke-linecap="round"/><path d="M22 7l4 3-4 3M22 19l4 3-4 3" fill="none" stroke="#fffbeb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { pattern: /sort/i, iconUrl: icon(`<path d="M10 8h13M10 16h9M10 24h5" stroke="#bae6fd" stroke-width="3" stroke-linecap="round"/><path d="M7 8v16M7 24l-3-3M7 24l3-3" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { pattern: /aggregate|stream aggregate/i, iconUrl: icon(`<path d="M9 8h15L16 16l8 8H9" fill="none" stroke="#86efac" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { pattern: /filter/i, iconUrl: icon(`<path d="M6 8h20l-8 9v6l-4 2v-8z" fill="#15803d" stroke="#86efac" stroke-width="2" stroke-linejoin="round"/>`) },
  { pattern: /compute scalar/i, iconUrl: icon(`<rect x="6" y="6" width="20" height="20" rx="5" fill="#be123c" stroke="#fda4af" stroke-width="2"/><path d="M11 13l3 3-3 3M16 21h5" stroke="#fff1f2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`) },
  { pattern: /parallelism|exchange/i, iconUrl: icon(`<path d="M6 10h8l4 6-4 6H6" fill="none" stroke="#a7f3d0" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 10h5l4 6-4 6h-5" fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round"/>`) },
  { pattern: /insert|update|delete/i, iconUrl: icon(`<rect x="7" y="8" width="18" height="16" rx="3" fill="#b45309" stroke="#fcd34d" stroke-width="2"/><path d="M16 12v8M12 16h8" stroke="#fffbeb" stroke-width="2" stroke-linecap="round"/>`) },
  { pattern: /spool/i, iconUrl: icon(`<ellipse cx="16" cy="9" rx="9" ry="4" fill="#475569" stroke="#cbd5e1" stroke-width="2"/><path d="M7 9v14c0 2 4 4 9 4s9-2 9-4V9" fill="#334155" stroke="#cbd5e1" stroke-width="2"/><path d="M7 16c0 2 4 4 9 4s9-2 9-4" fill="none" stroke="#94a3b8" stroke-width="2"/>`) }
];

export function resolveQueryPlanOperatorIcon(label?: string, kind?: string): string {
  const value = `${label ?? ""} ${kind ?? ""}`.trim();
  return operatorIcons.find((candidate) => candidate.pattern.test(value))?.iconUrl ?? fallbackIcon;
}

function icon(content: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${content}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
