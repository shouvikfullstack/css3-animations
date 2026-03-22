#!/usr/bin/env node

/**
 * Animotion MCP Server
 *
 * Model Context Protocol server that enables AI agents (Claude, GPT, etc.)
 * to search, retrieve, and compose CSS3 animations from the Animotion library.
 *
 * Tools provided:
 * - search_animations: Search animations by name, category, or tags
 * - get_animation: Get full CSS code for a specific animation
 * - list_categories: List all animation categories
 * - compose_animation: Compose custom animation with duration/easing/delay
 * - get_animation_css: Get just the CSS for direct use
 * - suggest_animation: AI-friendly suggestion based on use case description
 * - list_icon_providers: List available icon providers
 * - search_icons: Search icons across providers
 * - get_icon: Get SVG code for a specific icon
 * - add_custom_icon: Register a custom SVG icon for the session
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load animation data
let animationData;
try {
  const apiPath = join(__dirname, '..', 'api.json');
  animationData = JSON.parse(readFileSync(apiPath, 'utf-8'));
} catch {
  // Fallback: try loading from data.js by parsing it
  try {
    const dataPath = join(__dirname, '..', 'js', 'data.js');
    const content = readFileSync(dataPath, 'utf-8');
    const match = content.match(/window\.ANIMOTION_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (match) {
      animationData = JSON.parse(match[1]);
    }
  } catch {
    animationData = { categories: [], animations: [] };
  }
}

// Load icon data from icons.js
let iconData = { categories: [], icons: [] };
try {
  const iconsPath = join(__dirname, '..', 'js', 'icons.js');
  const content = readFileSync(iconsPath, 'utf-8');
  const match = content.match(/window\.ANIMOTION_ICONS\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (match) {
    iconData = JSON.parse(match[1]);
  }
} catch {
  // icons.js may not be pure JSON-parseable due to trailing commas etc.
  // Try a more lenient approach
  try {
    const iconsPath = join(__dirname, '..', 'js', 'icons.js');
    const content = readFileSync(iconsPath, 'utf-8');
    // Extract the object between the first { and last }
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      let jsonStr = content.substring(start, end + 1);
      // Remove trailing commas before } or ]
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
      iconData = JSON.parse(jsonStr);
    }
  } catch {
    iconData = { categories: [], icons: [] };
  }
}

// In-memory custom icons for the session
const customIcons = [];

// Icon provider metadata (for list_icon_providers)
const iconProviders = [
  {
    id: 'builtin',
    name: 'Animotion Built-in',
    type: 'builtin',
    description: '120 hand-crafted SVG icons included with Animotion. Works out of the box.',
    license: 'MIT',
    totalIcons: (iconData.icons || []).length,
    setup: 'No setup needed. Icons are available immediately.',
  },
  {
    id: 'lucide',
    name: 'Lucide Icons',
    type: 'free',
    description: 'Beautiful & consistent open-source icons. 1500+ icons.',
    license: 'ISC',
    totalIcons: 1500,
    setup: 'Free, no API key needed. On the website, select "Lucide Icons" from the provider dropdown and click "Load Icons". In MCP, use search_icons with provider="lucide" — note: external providers are only available via the website UI. The MCP server provides built-in icons directly.',
  },
  {
    id: 'heroicons',
    name: 'Heroicons',
    type: 'free',
    description: 'Hand-crafted SVG icons by the Tailwind CSS team. 300+ icons.',
    license: 'MIT',
    totalIcons: 300,
    setup: 'Free, no API key needed. On the website, select "Heroicons" and click "Load Icons".',
  },
  {
    id: 'tabler',
    name: 'Tabler Icons',
    type: 'free',
    description: '5000+ free MIT-licensed SVG icons.',
    license: 'MIT',
    totalIcons: 5000,
    setup: 'Free, no API key needed. On the website, select "Tabler Icons" and click "Load Icons".',
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap Icons',
    type: 'free',
    description: 'Official open-source icon library for Bootstrap. 2000+ icons.',
    license: 'MIT',
    totalIcons: 2000,
    setup: 'Free, no API key needed. On the website, select "Bootstrap Icons" and click "Load Icons".',
  },
  {
    id: 'fontawesome-pro',
    name: 'Font Awesome Pro',
    type: 'paid',
    description: 'Premium icon library with 26,000+ icons. Requires a Font Awesome Pro Kit ID.',
    license: 'Commercial',
    totalIcons: 26000,
    setup: 'Requires a Font Awesome Pro subscription. On the website, select "Font Awesome Pro", enter your Kit ID, and click "Load Icons". Get your Kit ID at fontawesome.com/kits.',
  },
  {
    id: 'streamline',
    name: 'Streamline Icons',
    type: 'paid',
    description: 'Premium library with 180,000+ icons. Requires an API key.',
    license: 'Commercial',
    totalIcons: 180000,
    setup: 'Requires a Streamline subscription. On the website, select "Streamline Icons", enter your API key, and click "Load Icons". Get your key at streamlinehq.com/developers.',
  },
  {
    id: 'custom',
    name: 'Custom Icons',
    type: 'custom',
    description: 'Upload your own SVG icons. Via the website, drag & drop SVGs. Via MCP, use the add_custom_icon tool.',
    license: 'Your own',
    totalIcons: 0,
    setup: 'On the website, select "Custom Icons" and drag & drop SVG files. Via MCP, use the add_custom_icon tool to register SVGs.',
  },
];

const server = new Server(
  {
    name: 'animotion',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ── Tools ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_animations',
      description: 'Search the Animotion CSS3 animation library. Returns matching animations with their CSS classes, descriptions, and code. Use this to find animations by name, category, tag, or technique.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — matches against animation name, description, CSS class, category, and tags. Examples: "fade in", "bounce", "loader", "3d flip", "button hover"',
          },
          category: {
            type: 'string',
            description: 'Filter by category. Options: entrance, exit, attention, text, background, button, card, loader, navigation, form, transform3d, filter, micro, scroll, creative, fintech, gaming, ecommerce, social, dashboard',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 10, max: 50)',
          },
        },
        required: [],
      },
    },
    {
      name: 'get_animation',
      description: 'Get the complete details and CSS code for a specific animation by its ID or CSS class name. Returns the @keyframes definition and usage class.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Animation ID (e.g., "E01") or CSS class name (e.g., "animotion-fade-in")',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_categories',
      description: 'List all animation categories with their names, icons, colors, and animation counts.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'compose_animation',
      description: 'Compose a custom animation CSS rule by combining an Animotion animation with custom duration, easing, delay, and iteration count. Returns ready-to-use CSS.',
      inputSchema: {
        type: 'object',
        properties: {
          animation: {
            type: 'string',
            description: 'Animation ID or CSS class name',
          },
          selector: {
            type: 'string',
            description: 'CSS selector for the target element (default: ".animated")',
          },
          duration: {
            type: 'string',
            description: 'Animation duration (e.g., "0.5s", "1200ms"). Default: animation default.',
          },
          easing: {
            type: 'string',
            description: 'Timing function (e.g., "ease-out", "cubic-bezier(0.4,0,0.2,1)"). Default: animation default.',
          },
          delay: {
            type: 'string',
            description: 'Animation delay (e.g., "0.2s", "500ms"). Default: "0s".',
          },
          iterationCount: {
            type: 'string',
            description: 'Iteration count (e.g., "1", "3", "infinite"). Default: animation default.',
          },
          fillMode: {
            type: 'string',
            description: 'Fill mode (none, forwards, backwards, both). Default: "both".',
          },
        },
        required: ['animation'],
      },
    },
    {
      name: 'suggest_animation',
      description: 'Suggest animations based on a use case description. Describe what you want to animate and how, and get the best matching animations. Great for AI agents building UIs.',
      inputSchema: {
        type: 'object',
        properties: {
          useCase: {
            type: 'string',
            description: 'Description of the animation need. Examples: "modal appearing on screen", "button hover effect", "loading spinner", "page section entering viewport", "notification popping up", "card flipping to show back"',
          },
          count: {
            type: 'number',
            description: 'Number of suggestions to return (default: 5)',
          },
        },
        required: ['useCase'],
      },
    },
    {
      name: 'get_animation_css',
      description: 'Get ONLY the CSS code for an animation — no metadata. Perfect for directly inserting into stylesheets. Returns the @keyframes and class rule.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Animation ID or CSS class name',
          },
          includeKeyframes: {
            type: 'boolean',
            description: 'Whether to include the @keyframes definition (default: true)',
          },
        },
        required: ['id'],
      },
    },

    // ── Icon Tools ──

    {
      name: 'list_icon_providers',
      description: 'List all available icon providers with their type (builtin, free, paid, custom), setup instructions, and icon counts. Built-in icons work immediately; external providers need setup via the website.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'search_icons',
      description: 'Search icons by name, ID, or tags. Works out of the box with built-in icons (120 icons). For external providers (Lucide, Heroicons, etc.), returns setup instructions since those must be loaded via the website.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — matches icon name, ID, and tags. Examples: "home", "arrow", "user", "heart"',
          },
          provider: {
            type: 'string',
            description: 'Provider ID to search within. Default: "builtin". Options: builtin, lucide, heroicons, tabler, bootstrap, fontawesome-pro, streamline, custom',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 20, max: 100)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_icon',
      description: 'Get the SVG code for a specific icon by its ID. Works directly with built-in and custom icons. For external providers, returns setup instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Icon ID (e.g., "home", "search", "arrow-right")',
          },
          provider: {
            type: 'string',
            description: 'Provider ID. Default: "builtin". Also searches custom icons.',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'add_custom_icon',
      description: 'Register a custom SVG icon for this MCP session. The icon can then be retrieved with get_icon or found via search_icons.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Unique icon ID (e.g., "my-logo", "custom-arrow")',
          },
          name: {
            type: 'string',
            description: 'Human-readable name (e.g., "My Logo", "Custom Arrow")',
          },
          svg: {
            type: 'string',
            description: 'Full SVG markup string',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for search (e.g., ["logo", "brand"])',
          },
        },
        required: ['id', 'name', 'svg'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'search_animations': {
      const { query, category, limit = 10 } = args;
      let results = animationData.animations || [];

      if (category) {
        results = results.filter(a => a.category === category);
      }

      if (query) {
        const q = query.toLowerCase();
        results = results.filter(a =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.cssClass.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q) ||
          (a.tags && a.tags.some(t => t.toLowerCase().includes(q)))
        );
      }

      results = results.slice(0, Math.min(limit, 50));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: results.length,
            animations: results.map(a => ({
              id: a.id,
              name: a.name,
              description: a.description,
              cssClass: a.cssClass,
              category: a.category,
              tags: a.tags,
              duration: a.duration,
            })),
          }, null, 2),
        }],
      };
    }

    case 'get_animation': {
      const { id } = args;
      const anim = findAnimation(id);

      if (!anim) {
        return {
          content: [{ type: 'text', text: `Animation not found: ${id}` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(anim, null, 2),
        }],
      };
    }

    case 'list_categories': {
      const categories = (animationData.categories || []).map(cat => {
        const count = (animationData.animations || []).filter(a => a.category === cat.id).length;
        return { ...cat, count };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ categories }, null, 2),
        }],
      };
    }

    case 'compose_animation': {
      const { animation, selector = '.animated', duration, easing, delay, iterationCount, fillMode = 'both' } = args;
      const anim = findAnimation(animation);

      if (!anim) {
        return {
          content: [{ type: 'text', text: `Animation not found: ${animation}` }],
          isError: true,
        };
      }

      const dur = duration || anim.duration;
      const ease = easing || anim.timingFunction;
      const del = delay || '0s';
      const iter = iterationCount || anim.iterationCount;

      const css = `${anim.keyframeCSS}\n\n${selector} {\n  animation: ${anim.keyframeName} ${dur} ${ease} ${del} ${iter} ${fillMode};\n}`;

      return {
        content: [{
          type: 'text',
          text: css,
        }],
      };
    }

    case 'suggest_animation': {
      const { useCase, count = 5 } = args;
      const suggestions = suggestAnimations(useCase, count);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            useCase,
            suggestions: suggestions.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              cssClass: s.cssClass,
              category: s.category,
              css: s.css,
              keyframeCSS: s.keyframeCSS,
              relevanceScore: s._score,
            })),
          }, null, 2),
        }],
      };
    }

    case 'get_animation_css': {
      const { id, includeKeyframes = true } = args;
      const anim = findAnimation(id);

      if (!anim) {
        return {
          content: [{ type: 'text', text: `Animation not found: ${id}` }],
          isError: true,
        };
      }

      let css = '';
      if (includeKeyframes) {
        css += anim.keyframeCSS + '\n\n';
      }
      css += anim.css;

      return {
        content: [{ type: 'text', text: css }],
      };
    }

    // ── Icon Tools ──

    case 'list_icon_providers': {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            providers: iconProviders.map(p => ({
              ...p,
              totalIcons: p.id === 'custom' ? customIcons.length : p.totalIcons,
            })),
            note: 'Built-in icons work immediately via search_icons and get_icon. External providers (free and paid) must be loaded via the Animotion website UI. Custom icons can be added via the add_custom_icon tool.',
          }, null, 2),
        }],
      };
    }

    case 'search_icons': {
      const { query, provider = 'builtin', limit = 20 } = args;
      const q = (query || '').toLowerCase().trim();

      if (!q) {
        return {
          content: [{ type: 'text', text: 'Please provide a search query.' }],
          isError: true,
        };
      }

      // Built-in icons: search directly
      if (provider === 'builtin') {
        let results = (iconData.icons || []).filter(icon =>
          icon.id.toLowerCase().includes(q) ||
          icon.name.toLowerCase().includes(q) ||
          (icon.tags && icon.tags.some(t => t.toLowerCase().includes(q)))
        );
        results = results.slice(0, Math.min(limit, 100));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              provider: 'builtin',
              query,
              count: results.length,
              icons: results.map(i => ({
                id: i.id,
                name: i.name,
                category: i.category,
                tags: i.tags,
                svg: i.svg,
              })),
            }, null, 2),
          }],
        };
      }

      // Custom icons: search the session store
      if (provider === 'custom') {
        let results = customIcons.filter(icon =>
          icon.id.toLowerCase().includes(q) ||
          icon.name.toLowerCase().includes(q) ||
          (icon.tags && icon.tags.some(t => t.toLowerCase().includes(q)))
        );
        results = results.slice(0, Math.min(limit, 100));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              provider: 'custom',
              query,
              count: results.length,
              icons: results,
            }, null, 2),
          }],
        };
      }

      // External providers: return instructions
      const provInfo = iconProviders.find(p => p.id === provider);
      if (!provInfo) {
        return {
          content: [{ type: 'text', text: `Unknown provider: ${provider}. Use list_icon_providers to see available providers.` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            provider: provider,
            available: false,
            message: `${provInfo.name} icons are not available directly via MCP. They must be loaded through the Animotion website.`,
            setup: provInfo.setup,
            alternative: 'You can search built-in icons (provider="builtin") which work immediately, or add custom icons via the add_custom_icon tool.',
          }, null, 2),
        }],
      };
    }

    case 'get_icon': {
      const { id, provider = 'builtin' } = args;

      // Search built-in
      if (provider === 'builtin' || !provider) {
        const icon = (iconData.icons || []).find(i => i.id === id);
        if (icon) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                id: icon.id,
                name: icon.name,
                category: icon.category,
                tags: icon.tags,
                svg: icon.svg,
                provider: 'builtin',
              }, null, 2),
            }],
          };
        }

        // Also check custom icons as fallback
        const customIcon = customIcons.find(i => i.id === id);
        if (customIcon) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...customIcon, provider: 'custom' }, null, 2),
            }],
          };
        }

        return {
          content: [{ type: 'text', text: `Icon not found: "${id}". Use search_icons to find available icons.` }],
          isError: true,
        };
      }

      // Custom
      if (provider === 'custom') {
        const icon = customIcons.find(i => i.id === id);
        if (icon) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ ...icon, provider: 'custom' }, null, 2),
            }],
          };
        }
        return {
          content: [{ type: 'text', text: `Custom icon not found: "${id}". Use add_custom_icon to register icons.` }],
          isError: true,
        };
      }

      // External provider
      const provInfo = iconProviders.find(p => p.id === provider);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            provider: provider,
            available: false,
            message: `${provInfo ? provInfo.name : provider} icons must be loaded via the Animotion website.`,
            setup: provInfo ? provInfo.setup : 'Unknown provider.',
          }, null, 2),
        }],
      };
    }

    case 'add_custom_icon': {
      const { id, name, svg, tags = [] } = args;

      if (!id || !name || !svg) {
        return {
          content: [{ type: 'text', text: 'id, name, and svg are required.' }],
          isError: true,
        };
      }

      // Remove existing icon with same id
      const existingIdx = customIcons.findIndex(i => i.id === id);
      if (existingIdx >= 0) customIcons.splice(existingIdx, 1);

      const icon = { id, name, category: 'custom', tags, svg };
      customIcons.push(icon);

      // Update custom provider count
      const customProv = iconProviders.find(p => p.id === 'custom');
      if (customProv) customProv.totalIcons = customIcons.length;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Custom icon "${name}" (${id}) registered successfully.`,
            icon,
            totalCustomIcons: customIcons.length,
          }, null, 2),
        }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ── Resources ──

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'animotion://catalog',
      name: 'Animation Catalog',
      description: 'Complete catalog of all animations with metadata',
      mimeType: 'application/json',
    },
    {
      uri: 'animotion://categories',
      name: 'Categories',
      description: 'List of all animation categories',
      mimeType: 'application/json',
    },
    {
      uri: 'animotion://utilities',
      name: 'Utility Classes',
      description: 'Available utility classes for duration, delay, easing, etc.',
      mimeType: 'text/plain',
    },
    {
      uri: 'animotion://icons',
      name: 'Built-in Icon Catalog',
      description: 'Complete catalog of all built-in SVG icons with metadata and SVG code',
      mimeType: 'application/json',
    },
    {
      uri: 'animotion://icon-providers',
      name: 'Icon Providers',
      description: 'List of all available icon providers (builtin, free, paid, custom) with setup instructions',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'animotion://catalog':
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(animationData, null, 2),
        }],
      };

    case 'animotion://categories':
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(animationData.categories || [], null, 2),
        }],
      };

    case 'animotion://utilities': {
      const utilitiesPath = join(__dirname, '..', 'css', 'utilities.css');
      try {
        const css = readFileSync(utilitiesPath, 'utf-8');
        return {
          contents: [{ uri, mimeType: 'text/css', text: css }],
        };
      } catch {
        return {
          contents: [{ uri, mimeType: 'text/plain', text: 'Utilities file not found' }],
        };
      }
    }

    case 'animotion://icons':
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            totalIcons: (iconData.icons || []).length,
            categories: iconData.categories || [],
            icons: (iconData.icons || []).map(i => ({
              id: i.id,
              name: i.name,
              category: i.category,
              tags: i.tags,
              svg: i.svg,
            })),
          }, null, 2),
        }],
      };

    case 'animotion://icon-providers':
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            providers: iconProviders.map(p => ({
              ...p,
              totalIcons: p.id === 'custom' ? customIcons.length : p.totalIcons,
            })),
            note: 'Built-in icons are available immediately via the search_icons and get_icon tools. External providers require setup via the Animotion website. Custom icons can be added via the add_custom_icon tool.',
          }, null, 2),
        }],
      };

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ── Helpers ──

function findAnimation(idOrClass) {
  if (!animationData.animations) return null;
  return animationData.animations.find(a =>
    a.id === idOrClass ||
    a.cssClass === idOrClass ||
    a.cssClass === `animotion-${idOrClass}`
  );
}

function suggestAnimations(useCase, count) {
  const keywords = useCase.toLowerCase().split(/\s+/);

  // Map common use case words to categories and tags
  const categoryMap = {
    'enter': 'entrance', 'appear': 'entrance', 'show': 'entrance', 'reveal': 'entrance',
    'open': 'entrance', 'mount': 'entrance', 'arrive': 'entrance',
    'exit': 'exit', 'leave': 'exit', 'hide': 'exit', 'disappear': 'exit',
    'close': 'exit', 'dismiss': 'exit', 'remove': 'exit',
    'attention': 'attention', 'notice': 'attention', 'highlight': 'attention',
    'shake': 'attention', 'bounce': 'attention', 'pulse': 'attention',
    'text': 'text', 'title': 'text', 'heading': 'text', 'type': 'text',
    'background': 'background', 'hero': 'background', 'gradient': 'background',
    'button': 'button', 'btn': 'button', 'click': 'button', 'hover': 'button',
    'cta': 'button',
    'card': 'card', 'panel': 'card', 'widget': 'card',
    'load': 'loader', 'loading': 'loader', 'spinner': 'loader', 'progress': 'loader',
    'wait': 'loader',
    'nav': 'navigation', 'menu': 'navigation', 'header': 'navigation',
    'sidebar': 'navigation',
    'form': 'form', 'input': 'form', 'field': 'form', 'checkbox': 'form',
    'toggle': 'form',
    '3d': 'transform3d', 'flip': 'transform3d', 'rotate': 'transform3d',
    'cube': 'transform3d', 'perspective': 'transform3d',
    'filter': 'filter', 'blur': 'filter', 'grayscale': 'filter',
    'micro': 'micro', 'interaction': 'micro', 'feedback': 'micro',
    'like': 'micro', 'notification': 'micro', 'toast': 'micro',
    'scroll': 'scroll', 'viewport': 'scroll', 'parallax': 'scroll',
    'creative': 'creative', 'artistic': 'creative', 'special': 'creative',
    'finance': 'fintech', 'money': 'fintech', 'chart': 'fintech',
    'price': 'fintech', 'stock': 'fintech',
    'game': 'gaming', 'physics': 'gaming', 'health': 'gaming',
    'power': 'gaming', 'level': 'gaming',
    'shop': 'ecommerce', 'cart': 'ecommerce', 'product': 'ecommerce',
    'buy': 'ecommerce',
    'social': 'social', 'share': 'social',
    'follow': 'social', 'story': 'social',
    'dashboard': 'dashboard', 'data': 'dashboard', 'metric': 'dashboard',
    'kpi': 'dashboard',
  };

  const animations = animationData.animations || [];

  // Score each animation
  const scored = animations.map(anim => {
    let score = 0;
    const searchStr = `${anim.name} ${anim.description} ${anim.tags.join(' ')} ${anim.category}`.toLowerCase();

    keywords.forEach(kw => {
      if (searchStr.includes(kw)) score += 2;
      if (anim.name.toLowerCase().includes(kw)) score += 3;
      if (anim.tags.some(t => t.includes(kw))) score += 2;
      if (categoryMap[kw] && anim.category === categoryMap[kw]) score += 4;
    });

    return { ...anim, _score: score };
  });

  return scored
    .filter(a => a._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, count);
}

// ── Start Server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Animotion MCP Server running on stdio');
}

main().catch(console.error);
