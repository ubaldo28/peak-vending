import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

/** What Peak does. Add a file to content/services/ and it appears everywhere. */
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/services' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    icon: z.enum(['layers', 'calendar', 'wrench', 'card', 'chart', 'shield', 'coffee', 'market']),
    order: z.number().default(50),
    featured: z.boolean().default(false),
    bullets: z.array(z.string()).default([]),
  }),
});

/** One entry per place a machine goes. Each gets its own page for local search. */
const locations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/locations' }),
  schema: z.object({
    title: z.string(),
    /** Shown on the index grid. One sentence. */
    summary: z.string(),
    /** Page <title> and H1 override, if the nav label is too short for SEO. */
    heading: z.string().optional(),
    metaDescription: z.string(),
    order: z.number().default(50),
    /** Specific pains this type of site has. Drives the bullet list. */
    points: z.array(z.string()).default([]),
    /** Product categories that actually sell here. */
    stock: z.array(z.string()).default([]),
  }),
});

/**
 * Sponsors. Add an entry to content/sponsors/sponsors.json and it renders
 * in the strip and on the sponsors block. No code change needed.
 */
const sponsors = defineCollection({
  loader: file('./content/sponsors/sponsors.json'),
  schema: z.object({
    name: z.string(),
    /** Path under /public, e.g. /sponsors/acme.svg */
    logo: z.string(),
    url: z.url().optional(),
    /** 'strip' shows in the thin band; 'feature' also gets a card. */
    tier: z.enum(['strip', 'feature']).default('strip'),
    blurb: z.string().optional(),
    order: z.number().default(50),
    active: z.boolean().default(true),
  }),
});

export const collections = { services, locations, sponsors };
