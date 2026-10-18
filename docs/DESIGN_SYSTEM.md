# PII Design System Specification

Welcome to the **PII Design System**. This guide provides the official tokens, layout archetypes, component primitives, and implementation steps for building new pages across the PII web application.

---

## 1. Core Principles

1. **Information Density with Breathability**: Maximize usable screen real estate without clutter. Use compact, vertical controls ($36\text{px}-40\text{px}$) and clear gutters.
2. **Definite Viewport Scaffolding**: Never trap content inside unconstrained intermediate containers. All full-height tools (tables, boards) must follow a rigid flex chain down to their internal scroll container with `scrollbar-gutter: stable`.
3. **Card-First Hierarchy**: Data tables, forms, and metric groups live inside rounded surface cards (`16px` border-radius, `1px solid var(--line)`, subtle elevation), preventing raw data from spilling onto gray page backgrounds.
4. **Instant Semantic Recognition**: Consistent colors for status (Green = active/ok, Amber = warning/review, Red = expired/alert, Purple = primary interactive).

---

## 2. Design Tokens (CSS Variables)

Declared on `:host` in `apps/web/src/styles.ts` and inherited across shadow DOM boundaries:

### Colors

| Token | Light Mode Value | Purpose |
|---|---|---|
| `--pri` | `#6355F6` | Primary action color (indigo-purple) |
| `--pri-h` | `#5246E0` | Primary hover state |
| `--pri-soft` | `#EEEBFF` | Light purple pill/button background |
| `--pri-soft2` | `#E0DBFF` | Hover state for soft purple elements |
| `--pri-line` | `#C7C2FB` | Light purple accent border |
| `--navy` | `#191C32` | Headings, primary numbers, strong titles |
| `--ink` | `#1E2238` | Default body text |
| `--mute` | `#6B7280` | Secondary labels, captions, helper text |
| `--faint` | `#9CA3AF` | Inactive icons, subtle placeholders |
| `--bg` | `#FFFFFF` | Card surface and input background |
| `--tint` | `#F9FAFB` | Table zebra hover, tile background |
| `--tint2` | `#F3F1FF` | Secondary tinted backgrounds |
| `--line` | `#EEF1F6` | Card borders and divider rules |
| `--line2` | `#E5E7EB` | Input and control borders |
| `--ok` / `--ok-soft` | `#0E8F5B` / `#E6F6EF` | Success, active status, compliant |
| `--warn` / `--warn-soft` | `#B7791F` / `#FDF3DD` | Due soon, attention needed, pending |
| `--err` / `--err-soft` | `#C81E3A` / `#FDE8EC` | Expired, failed, overdue, danger |

### Spacing & Metrics

| Token | Value | Purpose |
|---|---|---|
| `--ctl-h` | `40px` | Standard height for inputs, selects, and buttons |
| `--card-r` | `16px` | Standard card and panel corner radius |
| `--r` | `10px` | Medium radius for inner containers |
| `--r-sm` | `7px` | Small radius for buttons and chips |
| `--pg-max` | `1560px` | Max width for framed desktop pages on wide screens ($\ge 1100\text{px}$) |
| `--pg-gut` | `32px` | Horizontal gutter for framed pages |
| `--shadow-soft`| `0 1px 2px rgba(16,24,40,.04), 0 10px 28px rgba(16,24,40,.07)` | Elevation for cards and panels |

---

## 3. The 3 Page Layout Archetypes

Every page in PII belongs to one of three architectural layout patterns:

### Archetype 1: Standard Framed Page (Recommended for 90% of New Pages)
- **Use For:** Forms, settings, profile, partner directories, lists, reports, and detail pages.
- **Framing:** Default `framed = true` in `app.tsx`.
- **CSS Class:** Automatically wrapped in `.shell-main.pg-frame`.
- **Behavior:** Centered horizontally (up to $1560\text{px}$), standard gutters, vertical page scroll.
- **Starter Template:**
```tsx
import { PageHeader, Card, StatGrid, StatTile, SearchInput } from './ui.tsx';

export function MyNewView({ call, t }: { call: any; t: any }) {
  const [q, setQ] = useState('');

  return (
    <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
      <PageHeader
        title="Insurance Policies"
        subtitle="Active and pending policies across authorized branches"
        actions={<button class="btn">+ New Policy</button>}
      />

      <StatGrid>
        <StatTile label="Active Policies" value="482" />
        <StatTile label="Expiring this month" value="14" subtext="Requires renewal review" />
        <StatTile label="Pending Binding" value="5" />
      </StatGrid>

      <div style={{ marginTop: '20px' }}>
        <Card
          title="Policy Directory"
          action={{ label: "Export CSV", onClick: () => exportData() }}
        >
          <div style={{ marginBottom: '14px' }}>
            <SearchInput value={q} onInput={setQ} placeholder="Filter by policyholder..." />
          </div>

          <table>
            <thead>
              <tr>
                <th>Policyholder</th>
                <th>Carrier</th>
                <th>Status</th>
                <th>Effective Date</th>
              </tr>
            </thead>
            <tbody>
              <tr class="row">
                <td class="name">Acme Corp Ltd</td>
                <td>Canada Life</td>
                <td><span class="pill ok">Active</span></td>
                <td>2026-11-01</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
```

---

### Archetype 2: Full-Canvas Workspace (Pipelines & Boards)
- **Use For:** High-density data grids, Kanban drag-and-drop boards, interactive pipeline views.
- **Framing:** Set `framed = true` in `app.tsx` and wrap root in `<div class="root">`.
- **CSS Class:** Matches `.shell > .shell-main:has(.root)`.
- **Behavior:** Full width ($100\%$), full viewport height ($100\%$), zero outer page scroll. Only the internal `.wrap` container scrolls.
- **Important Rule:** Forms and quick-add inputs must be outside `.wrap` so sticky table headers stick cleanly inside `.wrap` without covering controls.
```tsx
return (
  <div class="pii">
    <div class="bar">...toolbar...</div>
    <div class="meta">...row counters & filters...</div>
    <div class="root">
      <form class="quick">...quick add inputs...</form>
      <div class="wrap">
        <table>
          <thead><tr><th style={{ position: 'sticky', top: 0, z-index: 2 }}>Header</th></tr></thead>
          <tbody>...rows...</tbody>
        </table>
      </div>
    </div>
  </div>
);
```

---

### Archetype 3: Custom Executive Overview (Dashboards)
- **Use For:** Unified workspaces and multi-widget KPI mission controls.
- **Framing:** Set `framed = false` in `app.tsx` (`class="shell-main pg-raw"`).
- **CSS Class:** `.pii-workspace`.
- **Behavior:** Responsive CSS grid (`repeat(auto-fill, minmax(320px, 1fr))`), compact metric tiles ($64\text{px}$ min-height), and fitted vertical density so dashboard panels fit within laptop viewports.

---

## 4. Reusable Component Kit (`apps/web/src/ui.tsx`)

Import pre-built, accessible UI components from `./ui.tsx`:

```tsx
import { PageHeader, Card, StatGrid, StatTile, Badge, SearchInput } from './ui.tsx';
```

### Components Reference

| Component | Props | Description |
|---|---|---|
| `<PageHeader>` | `title`, `subtitle?`, `actions?` | Top bar with large heading, responsive actions, and subtitle. |
| `<Card>` | `title?`, `subtitle?`, `action?`, `className?` | Elevated 16px white card surface with standardized border and header. |
| `<StatGrid>` | `children` | Responsive auto-wrapping grid for KPI metric tiles. |
| `<StatTile>` | `label`, `value`, `subtext?`, `onClick?` | $24\text{px}$ bold navy KPI counter with label and hover states. |
| `<Badge>` | `variant: 'ok' \| 'warn' \| 'bad' \| 'pri' \| 'neutral'` | Rounded status pill badge with WCAG-compliant colors. |
| `<SearchInput>` | `value`, `onInput`, `placeholder?` | 38px search input with embedded magnifying glass SVG icon. |

---

## 5. How to Build and Deploy a New Page (5 Steps)

Follow this recipe whenever adding a new feature or view:

### Step 1: Create the Component
Create `apps/web/src/your-feature.tsx`:
```tsx
import { useState } from 'preact/hooks';
import { PageHeader, Card } from './ui.tsx';
import type { Call, Strings, Locale } from './types.ts';

export function YourFeatureView({ call, t, locale }: { call: Call; t: Strings; locale: Locale }) {
  return (
    <div style={{ width: '100%', maxWidth: '1440px', margin: '0 auto' }}>
      <PageHeader title="New Feature" subtitle="Description of this workspace" />
      <Card title="Overview">
        <p>Feature content goes here.</p>
      </Card>
    </div>
  );
}
```

### Step 2: Register in `apps/web/src/types.ts`
Add the page ID to the `PageId` union:
```ts
export type PageId = 'home' | 'inbox' | 'pipelines' | ... | 'your-feature';
```

### Step 3: Register in Navigation (`apps/web/src/app.tsx`)
1. Add to `PAGES` array:
   ```ts
   const PAGES: PageId[] = [..., 'your-feature'];
   ```
2. Add an SVG icon path to `NAV_ICON`:
   ```ts
   'your-feature': 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3',
   ```
3. Add English and French localized label strings in `apps/web/src/i18n.ts`.

### Step 4: Add Route Switch in `apps/web/src/app.tsx`
Add a case in the `<div class="shell-main">` switch statement:
```tsx
: page === 'your-feature' ? <YourFeatureView call={call} t={t} locale={locale} />
```

### Step 5: Verify Build and Deploy
```bash
npm run typecheck
npm run build --workspace @pii/web
node --test --test-concurrency=1 apps/api/test/*.test.ts
git commit -am "feat: add your-feature page using design system"
git push origin main
```
Railway will automatically build the container and deploy the new page live.
