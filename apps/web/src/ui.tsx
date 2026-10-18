import type { ComponentChildren } from 'preact';

/**
 * Standard Page Header
 * Renders consistent title, optional subtitle, and actions aligned horizontally.
 */
export function PageHeader({ title, subtitle, actions }: {
  title: string;
  subtitle?: string;
  actions?: ComponentChildren;
}) {
  return (
    <header class="bar" style={{ border: 0, padding: '0 0 16px 0', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--navy)', margin: 0, letterSpacing: '-0.02em' }}>{title}</h1>
        {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--mute)', fontSize: '13.5px' }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>{actions}</div>}
    </header>
  );
}

/**
 * Standard Surface Card Container
 * Elevated white panel with uniform 16px radius, border, and optional header.
 */
export function Card({ title, subtitle, action, children, className = '' }: {
  title?: string;
  subtitle?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  children: ComponentChildren;
  className?: string;
}) {
  return (
    <section class={`ui-card ${className}`}>
      {(title || action) && (
        <header class="ui-card-head">
          <div>
            {title && <h2 class="ui-card-title">{title}</h2>}
            {subtitle && <p style={{ margin: '2px 0 0', color: 'var(--mute)', fontSize: '12.5px' }}>{subtitle}</p>}
          </div>
          {action && (
            action.href ? (
              <a class="ui-action-link" href={action.href}>{action.label} →</a>
            ) : (
              <button type="button" class="ui-action-link" onClick={action.onClick}>{action.label} →</button>
            )
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Responsive Stat Grid
 * Distributes metric tiles evenly across rows with automatic wrapping.
 */
export function StatGrid({ children }: { children: ComponentChildren }) {
  return <div class="ui-stat-grid">{children}</div>;
}

/**
 * Standard Metric / KPI Stat Tile
 * Displays bold numerical value with clear caption label and optional interactive state.
 */
export function StatTile({ label, value, subtext, onClick }: {
  label: string;
  value: string | number;
  subtext?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      class="ui-stat-tile"
      type={onClick ? 'button' : undefined}
      role={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <span class="ui-stat-val">{value}</span>
      <span class="ui-stat-lbl">{label}</span>
      {subtext && <small style={{ color: 'var(--mute)', fontSize: '11px', marginTop: '2px' }}>{subtext}</small>}
    </Comp>
  );
}

/**
 * Standard Status Badge / Pill
 */
export function Badge({ variant = 'neutral', children }: {
  variant?: 'ok' | 'warn' | 'bad' | 'pri' | 'neutral';
  children: ComponentChildren;
}) {
  const cls = variant === 'ok' ? 'pill ok'
    : variant === 'warn' ? 'pill warn'
    : variant === 'bad' ? 'pill bad'
    : variant === 'pri' ? 'pill a-people'
    : 'pill';
  return <span class={cls}>{children}</span>;
}

/**
 * Standard Search Input with embedded magnifying glass icon
 */
export function SearchInput({ value, onInput, placeholder, ariaLabel = 'Search' }: {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div style={{ position: 'relative', width: '280px', maxWidth: '100%' }}>
      <input
        class="search"
        style={{ width: '100%', maxWidth: 'none', paddingLeft: '34px', height: '38px', borderRadius: '10px' }}
        type="search"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
      <svg
        style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', width: '15px', height: '15px', stroke: 'var(--mute)', fill: 'none', strokeWidth: 2, pointerEvents: 'none' }}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </div>
  );
}
