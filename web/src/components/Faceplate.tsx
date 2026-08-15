// ---------------------------------------------------------------------------
// Faceplate: der Switch als Portbild.
//
// 36 Zeilen Tabelle beantworten "welcher Port hat was" schlecht. Ein Portbild
// beantwortet es auf einen Blick – vor allem die Frage, ob NAC flaechendeckend
// aktiv ist oder nur auf einer Handvoll Ports.
//
// Das Layout ist aus der Portliste abgeleitet: zwei Reihen, ungerade oben,
// gerade unten, wie bei einem RJ45-Feld. FortiOS bietet unter
// monitor/switch-controller/managed-switch/faceplate-xml auch das exakte
// physische Layout an; dessen Aufbau ist aber nicht dokumentiert und bisher
// nicht gegen ein echtes Geraet geprueft, deshalb wird hier nicht geraten.
// ---------------------------------------------------------------------------
import { useMemo } from 'react';
import type { Asset, PortStatus, SwitchPort } from '@/api/types';
import type { Pending } from '@/lib/project';
import { members } from '@/lib/format';

export type ColorMode = 'access-mode' | 'link' | 'coverage';

export interface FaceplatePort {
  port: Pending<SwitchPort>;
  status: PortStatus | null;
  adminDown: boolean;
  devices: Asset[];
}

/** Zahl am Ende des Portnamens, damit port10 nicht vor port2 landet. */
function portIndex(name: string): number {
  const m = /(\d+)\s*$/.exec(name);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function isUplink(p: FaceplatePort): boolean {
  return p.status?.isFortiLink === true || members(p.port['interface-tags'], 'tag-name').includes('uplink');
}

/** Farbe und Bedeutung je nach gewaehlter Sicht. */
export function portTone(p: FaceplatePort, mode: ColorMode): { tone: string; label: string } {
  if (mode === 'link') {
    if (p.adminDown) return { tone: 'red', label: 'admin down' };
    if (!p.status) return { tone: 'idle', label: 'unknown' };
    return p.status.link === 'up' ? { tone: 'green', label: 'link up' } : { tone: 'idle', label: 'link down' };
  }

  if (mode === 'coverage') {
    if (p.port['access-mode'] !== 'dynamic' || !p.port['port-policy']) return { tone: 'idle', label: 'not under NAC' };
    if (!p.devices.length) return { tone: 'blue', label: 'no device' };
    const unmatched = p.devices.filter((d) => !d.matchedRule).length;
    if (unmatched === 0) return { tone: 'green', label: 'all matched' };
    if (unmatched === p.devices.length) return { tone: 'amber', label: 'no rule matched' };
    return { tone: 'amber', label: `${unmatched} unmatched` };
  }

  const m = p.port['access-mode'] ?? 'static';
  if (m === 'dynamic') return { tone: 'green', label: 'dynamic' };
  if (m === 'nac') return { tone: 'violet', label: 'nac' };
  return { tone: 'idle', label: 'static' };
}

export function Faceplate({
  switchId,
  description,
  ports,
  colorMode,
  selected,
  onToggle,
  renderTooltip,
}: {
  switchId: string;
  description?: string;
  ports: FaceplatePort[];
  colorMode: ColorMode;
  selected: Set<string>;
  onToggle: (portName: string, additive: boolean) => void;
  renderTooltip?: (p: FaceplatePort) => string;
}) {
  const { rows, uplinks } = useMemo(() => {
    const sorted = [...ports].sort((a, b) => portIndex(a.port['port-name']) - portIndex(b.port['port-name']));
    const up = sorted.filter(isUplink);
    const access = sorted.filter((p) => !isUplink(p));
    // Physische Anordnung: ungerade oben, gerade unten.
    const top = access.filter((p) => portIndex(p.port['port-name']) % 2 === 1);
    const bottom = access.filter((p) => portIndex(p.port['port-name']) % 2 === 0);
    return { rows: [top, bottom], uplinks: up };
  }, [ports]);

  const cell = (p: FaceplatePort) => {
    const name = p.port['port-name'];
    const { tone, label } = portTone(p, colorMode);
    const isSelected = selected.has(name);
    const n = portIndex(name);
    const title = renderTooltip
      ? renderTooltip(p)
      : [name, p.port.description, label, p.devices.length ? `${p.devices.length} device(s)` : null].filter(Boolean).join(' · ');

    return (
      <button
        key={name}
        type="button"
        className={`fp-port tone-${tone} ${isSelected ? 'selected' : ''} ${p.port.__pending ? 'pending' : ''}`}
        title={title}
        aria-label={title}
        aria-pressed={isSelected}
        onClick={(e) => onToggle(name, e.ctrlKey || e.metaKey || e.shiftKey)}
      >
        <span className="fp-num">{Number.isFinite(n) && n !== Number.MAX_SAFE_INTEGER ? n : name}</span>
        {p.devices.length > 1 && <span className="fp-badge">{p.devices.length}</span>}
      </button>
    );
  };

  return (
    <div className="faceplate">
      <div className="fp-head">
        <span className="mono" style={{ fontWeight: 600 }}>{switchId}</span>
        {description && <span className="xs dim truncate">{description}</span>}
        <div className="spacer" />
        <span className="xs dim">{ports.length} ports</span>
      </div>

      <div className="fp-body">
        <div className="fp-grid">
          {rows.map((row, i) => (
            <div className="fp-row" key={i}>
              {row.map(cell)}
            </div>
          ))}
        </div>

        {uplinks.length > 0 && (
          <div className="fp-uplinks" title="Uplink and FortiLink ports">
            <div className="fp-grid">
              <div className="fp-row">{uplinks.filter((_, i) => i % 2 === 0).map(cell)}</div>
              <div className="fp-row">{uplinks.filter((_, i) => i % 2 === 1).map(cell)}</div>
            </div>
            <div className="fp-uplink-label">uplink</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Legende zur gewaehlten Einfaerbung. */
export function FaceplateLegend({ mode }: { mode: ColorMode }) {
  const items =
    mode === 'link'
      ? [
          ['green', 'Link up'],
          ['idle', 'Link down'],
          ['red', 'Administratively down'],
        ]
      : mode === 'coverage'
        ? [
            ['green', 'Every device matched'],
            ['amber', 'Device without a rule'],
            ['blue', 'Under NAC, no device'],
            ['idle', 'Not under NAC'],
          ]
        : [
            ['green', 'dynamic'],
            ['violet', 'nac'],
            ['idle', 'static'],
          ];

  return (
    <div className="row wrap xs dim" style={{ gap: 12 }}>
      {items.map(([tone, label]) => (
        <span className="row" key={label} style={{ gap: 5 }}>
          <span className={`fp-swatch tone-${tone}`} />
          {label}
        </span>
      ))}
    </div>
  );
}
