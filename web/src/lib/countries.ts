export interface Country { code: string; name: string; symbol: string; adzuna: boolean; group: string }

// Adzuna country codes; Sri Lanka has no Adzuna coverage (Jooble planned)
export const COUNTRIES: Country[] = [
  { code: 'gb', name: 'United Kingdom', symbol: '£', adzuna: true, group: 'UK' },
  { code: 'lk', name: 'Sri Lanka', symbol: 'Rs ', adzuna: false, group: 'Asia' },
  { code: 'in', name: 'India', symbol: '₹', adzuna: true, group: 'Asia' },
  { code: 'au', name: 'Australia', symbol: 'A$', adzuna: true, group: 'Oceania' },
  { code: 'nz', name: 'New Zealand', symbol: 'NZ$', adzuna: true, group: 'Oceania' },
  { code: 'ca', name: 'Canada', symbol: 'C$', adzuna: true, group: 'North America' },
  { code: 'de', name: 'Germany', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'fr', name: 'France', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'nl', name: 'Netherlands', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'it', name: 'Italy', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'es', name: 'Spain', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'at', name: 'Austria', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'be', name: 'Belgium', symbol: '€', adzuna: true, group: 'Europe' },
  { code: 'ch', name: 'Switzerland', symbol: 'CHF ', adzuna: true, group: 'Europe' },
  { code: 'pl', name: 'Poland', symbol: 'PLN ', adzuna: true, group: 'Europe' },
]

export const countryInfo = (code: string) => COUNTRIES.find(c => c.code === code)
