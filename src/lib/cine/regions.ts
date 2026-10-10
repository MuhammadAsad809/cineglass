export const REGIONS = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "IN", name: "India" },
  { code: "JP", name: "Japan" },
  { code: "BR", name: "Brazil" },
  { code: "PK", name: "Pakistan" },
  { code: "NG", name: "Nigeria" },
  { code: "KR", name: "South Korea" },
] as const;

export function regionName(code: string): string {
  return REGIONS.find((region) => region.code === code)?.name ?? code;
}

export function safeRegion(code: string): string {
  return /^[A-Z]{2}$/.test(code) ? code : "US";
}
