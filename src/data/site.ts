/**
 * Every piece of business information the site renders lives here.
 * Change it once and it updates the nav, footer, contact page,
 * structured data and email templates together.
 */
export const site = {
  name: 'Peak Vending',
  legalName: 'Peak Vending',
  domain: 'peak-vending.com',
  tagline: 'Full-service vending',

  // --- CONTACT -------------------------------------------------------------
  email: 'hello@peak-vending.com',
  phone: '(000) 000-0000',
  phoneHref: '+10000000000',

  // --- SERVICE AREA --------------------------------------------------------
  // Used in the footer and in the LocalBusiness structured data.
  areaServed: 'Your metro area',
  address: {
    street: '',
    city: '',
    region: '',
    postalCode: '',
    country: 'US',
  },

  // --- SOCIAL (leave blank to hide) ---------------------------------------
  social: {
    facebook: '',
    instagram: '',
    linkedin: '',
  },

  hours: 'Monday to Friday, 8am to 5pm',
} as const;

export const nav = [
  { href: '/services/', label: 'Services' },
  { href: '/locations/', label: 'Locations we serve' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
] as const;

/** Short trust points shown in the strip under the homepage hero. */
export const proofPoints = [
  { title: 'No cost to the location', body: 'Machines, install, and stocking on us' },
  { title: 'Tap, swipe, or cash', body: 'Card readers standard on every unit' },
  { title: 'Restocked on a route', body: 'Regular visits, not on-request' },
  { title: 'One number to call', body: 'Same person every time' },
] as const;
