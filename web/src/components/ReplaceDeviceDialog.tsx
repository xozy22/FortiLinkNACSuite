// ---------------------------------------------------------------------------
// Geraetetausch.
//
// Geht ein Geraet kaputt, hat der Ersatz eine andere MAC – jede Regel, die auf
// die alte Adresse zeigt, greift danach ins Leere. Der Dialog sucht alle
// betroffenen Regeln und schreibt die neue Adresse hinein.
//
// Bewusst NICHT auf ein Geraet aus dem Inventar beschraenkt: Das defekte Geraet
// ist meist schon abgeklemmt und taucht dort nicht mehr auf. Die alte MAC kommt
// deshalb auch aus den Regeln selbst.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowRightLeft, Cable, Repeat2, Search } from 'lucide-react';
import type { Asset, Dpp, DppRule } from '@/api/types';
import { Modal, Note } from './common';
import { isMac, normMac, pluralize, relTime, truncate } from '@/lib/format';
import { modifyRule } from '@/lib/ops';
import { useChangeset } from '@/state/changeset';
import { useToast } from '@/state/toast';
import type { Pending } from '@/lib/project';

interface AffectedRule {
  dpp: string;
  rule: DppRule;
}

/** Alle Regeln, die auf eine MAC zeigen – ueber alle Policies hinweg. */
export function rulesReferencing(dpps: Dpp[], mac: string): AffectedRule[] {
  const needle = normMac(mac);
  if (!needle) return [];
  const out: AffectedRule[] = [];
  for (const d of dpps) {
    for (const r of d.policy ?? []) {
      if ((r as Pending<DppRule>).__pending === 'delete') continue;
      if (normMac(String(r.mac ?? '')) === needle) out.push({ dpp: d.name, rule: r });
    }
  }
  return out;
}

/** Jede MAC, die irgendeine Regel referenziert – auch ohne Geraet im Inventar. */
function macsInRules(dpps: Dpp[]): string[] {
  const set = new Set<string>();
  for (const d of dpps) {
    for (const r of d.policy ?? []) {
      if (r.mac) set.add(normMac(String(r.mac)));
    }
  }
  return [...set].sort();
}

export function ReplaceDeviceDialog({
  dpps,
  assets,
  initialOldMac = '',
  initialNewMac = '',
  onClose,
}: {
  dpps: Dpp[];
  assets: Asset[];
  initialOldMac?: string;
  initialNewMac?: string;
  onClose: () => void;
}) {
  const cs = useChangeset();
  const toast = useToast();

  const [oldMac, setOldMac] = useState(normMac(initialOldMac));
  const [newMac, setNewMac] = useState(normMac(initialNewMac));

  const byMac = useMemo(() => new Map(assets.map((a) => [a.mac, a])), [assets]);
  const oldAsset = byMac.get(normMac(oldMac)) ?? null;
  const newAsset = byMac.get(normMac(newMac)) ?? null;

  const affected = useMemo(() => rulesReferencing(dpps, oldMac), [dpps, oldMac]);
  const newAlreadyUsed = useMemo(() => rulesReferencing(dpps, newMac), [dpps, newMac]);

  /**
   * Sitzt der Ersatz ueberhaupt dort, wo die umgeschriebene Regel gilt?
   * Ein Tausch auf ein Geraet an einem statischen Port oder unter einer anderen
   * Policy schreibt eine Regel, die nie greift – der haeufigste stille Fehlschlag.
   */
  const reachability = useMemo(() => {
    if (!newAsset || !affected.length) return null;
    if (!newAsset.onSwitch) return { kind: 'off-switch' as const, policies: [] as string[] };
    if (newAsset.accessMode !== 'dynamic' || !newAsset.portPolicy) {
      return { kind: 'port-static' as const, policies: [] as string[] };
    }
    const rulePolicies = [...new Set(affected.map((a) => a.dpp))];
    if (!rulePolicies.includes(newAsset.portPolicy)) {
      return { kind: 'other-policy' as const, policies: rulePolicies };
    }
    return null;
  }, [newAsset, affected]);

  const oldValid = isMac(oldMac);
  const newValid = isMac(newMac);
  const same = oldValid && newValid && normMac(oldMac) === normMac(newMac);
  const canApply = oldValid && newValid && !same && affected.length > 0;

  // Kandidaten fuer das Ersatzgeraet: frisch gesehen und noch ohne Regel zuerst –
  // genau so sieht ein gerade eingestecktes Austauschgeraet aus.
  const replacementCandidates = useMemo(() => {
    return [...assets]
      .filter((a) => a.mac !== normMac(oldMac))
      .sort((a, b) => {
        const score = (x: Asset) => (x.online ? 0 : 2) + (x.matchedRule ? 1 : 0);
        return score(a) - score(b) || (a.lastSeen ?? 1e9) - (b.lastSeen ?? 1e9);
      });
  }, [assets, oldMac]);

  const oldCandidates = useMemo(() => {
    const fromRules = macsInRules(dpps);
    return fromRules.map((m) => ({ mac: m, asset: byMac.get(m) ?? null }));
  }, [dpps, byMac]);

  function submit() {
    const target = normMac(newMac);
    for (const { dpp, rule } of affected) {
      // before ist die Regel wie gelesen – Basis fuer Diff und Konflikterkennung.
      cs.add(modifyRule(dpp, rule, { ...rule, mac: target }));
    }
    toast(
      'ok',
      `Staged ${pluralize(affected.length, 'rule change')}`,
      `${normMac(oldMac)} → ${target}. Review it in the changes panel.`
    );
    onClose();
  }

  return (
    <Modal
      title="Replace a device"
      subtitle="Point every rule that matches the old MAC address at the replacement"
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canApply}>
            <Repeat2 size={13} /> Stage {pluralize(affected.length, 'rule change')}
          </button>
        </>
      }
    >
      <div className="grid grid-2">
        {/* Altes Geraet */}
        <div className="fieldset">
          <legend>Device being replaced</legend>
          <MacInput
            value={oldMac}
            onChange={setOldMac}
            placeholder="aa:bb:cc:dd:ee:ff"
            invalid={!!oldMac && !oldValid}
            label="Old MAC address"
          />
          {oldAsset ? (
            <DeviceCard asset={oldAsset} />
          ) : oldValid ? (
            <div className="xs dim">
              Not in the current inventory — expected if the device is already unplugged.
            </div>
          ) : null}

          {oldCandidates.length > 0 && (
            <details>
              <summary className="xs muted" style={{ cursor: 'pointer' }}>
                Pick from the {oldCandidates.length} MAC addresses used in rules
              </summary>
              <div className="panel" style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
                {oldCandidates.map(({ mac, asset }) => (
                  <div
                    key={mac}
                    className="facet-opt"
                    style={{ padding: '6px 9px' }}
                    onClick={() => setOldMac(mac)}
                  >
                    <span className="mono xs">{mac}</span>
                    <span className="xs dim truncate">{asset ? asset.hostname || asset.vendor : 'no device seen'}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        {/* Neues Geraet */}
        <div className="fieldset">
          <legend>Replacement device</legend>
          <MacInput
            value={newMac}
            onChange={setNewMac}
            placeholder="aa:bb:cc:dd:ee:ff"
            invalid={(!!newMac && !newValid) || same}
            label="New MAC address"
          />
          {newAsset ? (
            <DeviceCard asset={newAsset} />
          ) : newValid ? (
            <div className="xs" style={{ color: 'var(--amber)' }}>
              Not seen by the FortiGate yet. The rule will be written, but nothing matches until the device appears.
            </div>
          ) : null}

          <DevicePicker devices={replacementCandidates} onPick={(a) => setNewMac(a.mac)} selected={normMac(newMac)} />
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button
          className="btn sm"
          onClick={() => {
            const a = oldMac;
            setOldMac(newMac);
            setNewMac(a);
          }}
          disabled={!oldMac && !newMac}
          title="Swap the two addresses"
        >
          <ArrowRightLeft size={12} /> Swap
        </button>
      </div>

      {/* Befunde */}
      {same && <Note kind="err">Both addresses are the same — nothing to replace.</Note>}

      {oldValid && affected.length === 0 && (
        <Note kind="warn">
          No rule matches <code>{normMac(oldMac)}</code>. Nothing to rewrite — either the device was covered by a
          vendor or type rule rather than by its MAC, or its rule was already changed.
        </Note>
      )}

      {reachability?.kind === 'port-static' && newAsset && (
        <Note kind="warn">
          <strong>The replacement sits on a port NAC does not control.</strong> {newAsset.switchId} /{' '}
          {newAsset.portName} is in <code>{newAsset.accessMode || 'static'}</code> access mode, so the rewritten rule will
          never run there. Switch that port to dynamic access mode on the Port Assignment page.
        </Note>
      )}

      {reachability?.kind === 'other-policy' && newAsset && (
        <Note kind="warn">
          <strong>The replacement is on a port running a different policy.</strong> {newAsset.switchId} /{' '}
          {newAsset.portName} uses <code>{newAsset.portPolicy}</code>, but the rewritten{' '}
          {affected.length === 1 ? 'rule lives' : 'rules live'} in <code>{reachability.policies.join(', ')}</code>. Either
          move the device to a port under that policy, or add the rule to <code>{newAsset.portPolicy}</code>.
        </Note>
      )}

      {reachability?.kind === 'off-switch' && (
        <Note kind="info">
          The replacement was not seen on a FortiLink switch port. That is fine if it is not plugged in yet — the rule
          applies once it appears.
        </Note>
      )}

      {newAlreadyUsed.length > 0 && (
        <Note kind="warn">
          <strong>{normMac(newMac)} is already used by {pluralize(newAlreadyUsed.length, 'rule')}</strong> (
          {newAlreadyUsed.map((a) => `${a.dpp}/${a.rule.name}`).join(', ')}). After this change two rules would match the same
          device, and only the first one in the list would apply.
        </Note>
      )}

      {affected.length > 0 && (
        <div className="fieldset">
          <legend>{pluralize(affected.length, 'rule')} will be rewritten</legend>
          <div className="panel">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Rule</th>
                  <th>MAC</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {affected.map(({ dpp, rule }) => (
                  <tr key={`${dpp}/${rule.name}`}>
                    <td className="xs mono">{dpp}</td>
                    <td>
                      <div className="sm" style={{ fontWeight: 500 }}>
                        {rule.name}
                      </div>
                      {rule.description && <div className="xs dim truncate">{rule.description}</div>}
                    </td>
                    <td className="xs mono">
                      <div className="from" style={{ color: 'var(--diff-del)', textDecoration: 'line-through' }}>
                        {normMac(String(rule.mac))}
                      </div>
                      <div style={{ color: 'var(--diff-add)' }}>
                        <ArrowDown size={9} /> {newValid ? normMac(newMac) : '…'}
                      </div>
                    </td>
                    <td className="xs">
                      {[rule['vlan-policy'], rule['802-1x'], rule['qos-policy'], rule['lldp-profile']]
                        .filter(Boolean)
                        .join(' · ') || <span className="dim">none</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Note kind="info">
            Only the MAC address changes — names, VLAN assignment and every other action stay as they are, so the
            replacement is treated exactly like its predecessor.
            {newAsset?.onSwitch && (
              <>
                {' '}
                The replacement sits on <code>{newAsset.switchId} / {newAsset.portName}</code>; FortiOS re-evaluates it when
                it reconnects, or immediately if you bounce that port from the Port Assignment page.
              </>
            )}
          </Note>
        </div>
      )}
    </Modal>
  );
}

// --- Bausteine -------------------------------------------------------------

function MacInput({
  value,
  onChange,
  placeholder,
  invalid,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  label: string;
}) {
  return (
    <div className="field">
      <label>
        {label}
        <span className="req">*</span>
      </label>
      <input
        className={`input mono ${invalid ? 'invalid' : ''}`}
        value={value}
        // Erst beim Verlassen normalisieren, sonst kaempft der Cursor beim Tippen.
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onChange(normMac(e.target.value))}
        placeholder={placeholder}
        spellCheck={false}
      />
      {invalid && <div className="err">Enter a full MAC address, for example aa:bb:cc:dd:ee:ff</div>}
    </div>
  );
}

function DeviceCard({ asset }: { asset: Asset }) {
  return (
    <div className="panel" style={{ padding: '9px 11px' }}>
      <div className="row" style={{ gap: 7 }}>
        <span className={`dot ${asset.online ? 'on' : 'off'}`} />
        <span className="sm" style={{ fontWeight: 500 }}>
          {asset.hostname || <span className="dim">unnamed</span>}
        </span>
        {asset.matchedRule ? (
          <span className="badge green">{asset.matchedRule}</span>
        ) : (
          <span className="badge amber">no rule</span>
        )}
      </div>
      <div className="xs dim mono" style={{ marginTop: 3 }}>
        {asset.macDisplay}
        {asset.ipv4 && ` · ${asset.ipv4}`}
      </div>
      <div className="xs dim">
        {[asset.vendor, asset.type, asset.family].filter(Boolean).join(' · ') || 'unidentified'}
      </div>
      {asset.onSwitch && (
        <div className="xs dim row" style={{ marginTop: 3 }}>
          <Cable size={10} />
          {asset.switchId} / {asset.portName}
          {asset.vlanId !== null && ` · vlan ${asset.vlanId}`}
          <span className="spacer" />
          {relTime(asset.lastSeen)}
        </div>
      )}
    </div>
  );
}

function DevicePicker({
  devices,
  onPick,
  selected,
}: {
  devices: Asset[];
  onPick: (a: Asset) => void;
  selected: string;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? devices.filter((d) =>
          [d.hostname, d.macDisplay, d.ipv4, d.vendor, d.type, d.switchId, d.portName]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : devices;
    return base.slice(0, 60);
  }, [devices, q]);

  return (
    <div className="field">
      <label>Or pick it from the inventory</label>
      <div className="search" style={{ maxWidth: 'none' }}>
        <Search size={13} />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hostname, MAC, IP, port…"
          spellCheck={false}
        />
      </div>
      <div className="panel" style={{ maxHeight: 210, overflowY: 'auto', marginTop: 4 }}>
        {filtered.length === 0 && <div className="xs dim" style={{ padding: 10 }}>No device matches.</div>}
        {filtered.map((d) => (
          <div
            key={d.mac}
            className="facet-opt"
            style={{
              padding: '6px 9px',
              alignItems: 'flex-start',
              background: d.mac === selected ? 'var(--accent-soft)' : undefined,
            }}
            onClick={() => onPick(d)}
          >
            <span className={`dot ${d.online ? 'on' : 'off'}`} style={{ marginTop: 5 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="xs truncate" style={{ fontWeight: 500 }}>
                {d.hostname || <span className="dim">unnamed</span>}
              </div>
              <div className="xs dim mono truncate">{d.macDisplay}</div>
              <div className="xs dim truncate">
                {truncate([d.vendor, d.type].filter(Boolean).join(' · ') || 'unidentified', 40)}
                {d.onSwitch && ` · ${d.portName}`}
              </div>
            </div>
            {!d.matchedRule && <span className="badge amber">no rule</span>}
          </div>
        ))}
      </div>
      <div className="hint">Devices without a rule are listed first — a freshly connected replacement usually has none yet.</div>
    </div>
  );
}
