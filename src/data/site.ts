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
  email: 'info@peak-vending.com',
  // Leave these empty and the phone disappears from the nav, footer, contact
  // page, thanks page and the structured data. Fill them in to bring it back.
  phone: '',
  phoneHref: '',

  // --- SERVICE AREA --------------------------------------------------------
  /** Short form, used in running copy. */
  areaServed: 'Dundee, Angus, Fife and Perthshire',
  /** Used in the LocalBusiness structured data and the coverage list. */
  areas: [
    { name: 'Dundee', blurb: 'City centre, the Technology Park, and the industrial estates out toward Camperdown.' },
    { name: 'Angus', blurb: 'Arbroath, Forfar, Montrose, Brechin and the estates in between.' },
    { name: 'Fife', blurb: 'Glenrothes, Kirkcaldy, Dunfermline, Cupar and the east Neuk towns.' },
    { name: 'Perth & Kinross', blurb: 'Perth, Scone, Blairgowrie, Crieff and the surrounding parks.' },
  ],
  address: {
    street: '',
    city: 'Dundee',
    region: 'Scotland',
    postalCode: '',
    country: 'GB',
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
  { href: '/locations/', label: 'Where we install' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
] as const;

/** Short trust points shown in the strip under the homepage hero. */
export const proofPoints = [
  { title: 'No cost to you or your business', body: 'Machines, delivery and stocking are all taken care of by us' },
  { title: 'Contactless as standard', body: 'Card and phone payment option available on every machine' },
  { title: 'Live sales reporting', body: 'We monitor sales and return when your favourite products are running low' },
  { title: 'One direct number to call', body: 'Getting in touch made simple' },
] as const;
