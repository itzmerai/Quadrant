import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CancelToken,
  areaKm2,
  formatBBox,
  leadsToCsv,
  loadZipIndex,
  runScan,
  guessWebsites,
  crawlForEmails,
  deriveEmailHuntResult,
  deriveScanResult,
  mergeEnrichment,
  territoryScanState,
  suggestFilename,
  zipsInBBox,
  territoryHex,
  type BBox,
  type Lead,
  type ScanProgress,
  type Territory,
  type TerritoryStore,
  type ZipIndex,
  createFileStore,
  uniqueSlug,
} from '@quadrant/core';



import { MapPicker } from './components/MapPicker';
import { MapResizer } from './components/MapResizer';
import { SettingsPanel } from './components/SettingsPanel';
import { NameBoxDialog } from './components/NameBoxDialog';
import { LeadTable } from './components/LeadTable';
import { TerritoryMenu } from './components/TerritoryMenu';
import { getFs, getHttp, STORAGE_LABEL } from './lib/runtime';
import { usePreferences } from './lib/PreferencesContext';

export default function App() {
  // 42k ZIP centroids. Served as a static asset rather than inlined into the
  // bundle - a 1.5 MB string in JS costs 8 MB after escaping and source maps.
  const [zipIndex, setZipIndex] = useState<ZipIndex>([]);

  const [store, setStore] = useState<TerritoryStore | null>(null);
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  // What the table is actually showing, so Export matches the screen.
  const [visible, setVisible] = useState<Lead[]>([]);

  const { prefs, update, resolvedTheme } = usePreferences();
  const mainRef = useRef<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tracked separately from the stored value so the drag stays smooth and only
  // the released height is persisted.
  const [mapHeightPct, setMapHeightPct] = useState(prefs.mapHeightPct);

  const [drawing, setDrawing] = useState(false);
  const [pendingBox, setPendingBox] = useState<BBox | null>(null);

  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const cancelRef = useRef<CancelToken | null>(null);

  /* --- boot --- */
  useEffect(() => {
    (async () => {
      const res = await fetch('/zip-centroids.csv');
      setZipIndex(loadZipIndex(await res.text()));
    })().catch(() => setZipIndex([]));

    (async () => {
      const s = createFileStore(await getFs());
      setStore(s);
      const list = await s.listTerritories();
      setTerritories(list);
      if (list.length) setSelectedId(list[0]!.id);
    })();
  }, []);

  /* --- load leads whenever the selected box changes --- */
  useEffect(() => {
    if (!store || !selectedId) {
      setLeads([]);
      return;
    }
    store.getLeads(selectedId).then(setLeads);
  }, [store, selectedId]);

  const selected = territories.find((t) => t.id === selectedId) ?? null;

  // 42k-row scan; recompute only when the box or the index actually changes.
  const selectedZipCount = useMemo(
    () => (selected ? zipsInBBox(zipIndex, selected.bbox).length : 0),
    [zipIndex, selected?.id, selected?.bbox],
  );
  const pendingZipCount = useMemo(
    () => (pendingBox ? zipsInBBox(zipIndex, pendingBox).length : 0),
    [zipIndex, pendingBox],
  );

  /** R4 — a closed map cannot be drawn on, so reopen before entering draw mode. */
  function startDrawing() {
    if (drawing) { setDrawing(false); return; }
    if (prefs.mapClosed) update({ mapClosed: false });
    setDrawing(true);
  }

  /* --- create a named box --- */
  const handleDrawn = useCallback((bbox: BBox) => {
    setDrawing(false);
    setPendingBox(bbox);
  }, []);

  async function createTerritory(name: string, specialties: string[]) {
    if (!store || !pendingBox) return;
    const taken = new Set(territories.map((t) => t.id));
    const id = uniqueSlug(name, taken);

    const territory: Territory = {
      id,
      name: name.trim(),
      bbox: pendingBox,
      country: 'US',
      specialties,
      createdAt: new Date().toISOString(),
      lastScanAt: null,
      lastPartialScanAt: null,
      leadCount: 0,
    };

    await store.saveTerritory(territory);
    setTerritories(await store.listTerritories());
    setSelectedId(id);
    setPendingBox(null);
  }

  /* --- scan --- */
  async function startScan(territory: Territory) {
    if (!store) return;
    setWarnings([]);
    const cancel = new CancelToken();
    cancelRef.current = cancel;
    setProgress({
      phase: 'resolving', message: 'Starting', current: 0, total: 0, leadsFound: 0,
    });

    try {
      const http = await getHttp();
      const result = await runScan({
        territory,
        http,
        zipIndex,
        cancel,
        onProgress: setProgress,
        enrichWebsites: true,
      });

      // A stop is not a reason to skip the save - it is the reason the save
      // matters (R2). The merge runs exactly as it does on a completed scan.
      const report = await store.mergeLeads(territory.id, result.leads);
      const derived = deriveScanResult({
        cancelled: result.cancelled,
        report,
        territory,
        at: new Date().toISOString(),
      });
      /**
       * Re-read rather than writing back the snapshot this run started with.
       * A scan takes minutes and `territory` is frozen at its beginning, so
       * saving it reverted a colour she picked while it ran - and could
       * recreate a box she deleted mid-scan, leads and all.
       */
      const current = await store.getTerritory(territory.id);
      if (!current) return; // deleted while the scan ran; it stays deleted
      const updated: Territory = {
        ...current,
        ...derived.scanState,
        leadCount: derived.leadCount,
      };
      await store.saveTerritory(updated);

      setTerritories(await store.listTerritories());
      setLeads(await store.getLeads(territory.id));
      setWarnings(result.warnings);
      // Last, and only once both writes above have landed. This phase is what
      // re-enables Delete and Rescan, so what is on disk has to be complete
      // before it flips (KTD9, R5).
      setProgress({
        phase: derived.phase,
        message: derived.message,
        current: 1, total: 1, leadsFound: derived.leadCount,
      });
    } catch (err) {
      // `runScan` returns a stop rather than throwing one (KTD2), so anything
      // arriving here is a genuine failure and is reported as one.
      setProgress({
        phase: 'error',
        message: String(err),
        current: 0, total: 0, leadsFound: 0,
      });
    } finally {
      cancelRef.current = null;
    }
  }

  /**
   * Email hunting is a second pass on purpose. It is far slower than the scan
   * (a request per practice, sometimes several), so she gets a usable call
   * sheet first and enriches it while she is already working the phones.
   */
  async function findEmails(territory: Territory) {
    if (!store) return;
    // One long operation at a time. Guarding on the token rather than the
    // rendered phase closes the window below, where no phase existed yet.
    if (cancelRef.current) return;
    setWarnings([]);
    const cancel = new CancelToken();
    cancelRef.current = cancel;
    /**
     * Announce before the first long await, the way the scan does. Without
     * this the hunt ran with no phase at all until the enrichers reported -
     * and domain guessing only reports every tenth lead - so Stop was not
     * rendered, Delete stayed live, and a second run could start over the top.
     */
    setProgress({
      phase: 'enriching',
      message: 'Starting email hunt',
      current: 0,
      total: leads.length,
      leadsFound: leads.length,
    });

    
    try {
      const http = await getHttp();
      const guessed = await guessWebsites(leads, http, setProgress, cancel);
      const crawled = await crawlForEmails(guessed.leads, http, setProgress, cancel);

      // Fold onto what is on disk right now rather than writing back the
      // snapshot this hunt started from. It runs for minutes, and a status or
      // note she set while it ran must survive the save (R15).
      // Baseline from the same read the fold uses, not from the React snapshot
      // this run started with - mixing the two could report a negative gain.
      const stored = await store.getLeads(territory.id);
      const before = stored.filter((l) => l.email).length;
      const merged = mergeEnrichment(stored, crawled.leads);
      await store.saveLeads(territory.id, merged);
      setLeads(merged);

      // Saved first, reported second, and branched on the returned flag - the
      // enrichers hand a stop back as a value now, so a catch would never see
      // one and the hunt would claim it finished (R3, R14).
      const derived = deriveEmailHuntResult({
        cancelled: guessed.cancelled || crawled.cancelled,
        gained: merged.filter((l) => l.email).length - before,
        resolved: guessed.resolved,
        rejected: guessed.rejected,
        leadCount: merged.length,
      });
      setProgress({
        phase: derived.phase,
        message: derived.message,
        current: 1, total: 1, leadsFound: derived.leadCount,
      });
    } catch (err) {
      setProgress({
        phase: 'error',
        message: String(err),
        current: 0, total: 0, leadsFound: leads.length,
      });
    } finally {
      cancelRef.current = null;
    }
  }

  async function patchLead(leadId: string, patch: Partial<Lead>) {
    if (!store || !selectedId) return;
    const next = await store.updateLead(selectedId, leadId, patch);
    if (next) setLeads((prev) => prev.map((l) => (l.id === leadId ? next : l)));
  }

  async function setTerritoryColor(t: Territory, color: string) {
    if (!store) return;
    await store.saveTerritory({ ...t, color });
    setTerritories(await store.listTerritories());
  }

  async function deleteTerritory(t: Territory) {
    if (!store) return;
    // Counted from disk, not from the cached field: a prompt about deleting
    // data must not understate what it is about to remove.
    const actual = (await store.getLeads(t.id)).length;
    if (!confirm('Delete "' + t.name + '" and all ' + actual + ' of its leads?')) return;
    await store.deleteTerritory(t.id);
    const list = await store.listTerritories();
    setTerritories(list);
    setSelectedId(list[0]?.id ?? null);
  }

  function exportCsv() {
    if (!selected || !leads.length) return;
    const rows = visible.length ? visible : leads;
    const blob = new Blob([leadsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestFilename(selected);
    a.click();
    URL.revokeObjectURL(url);
  }

  const scanning = progress != null && ['resolving', 'querying', 'filtering', 'enriching'].includes(progress.phase);

  return (
    <div className={'app' + (prefs.sidebarCollapsed ? ' rail' : '')}>
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" width="30" height="30" />
          <div className="brand-text">
            <h1>Quadrant</h1>
            <p>{STORAGE_LABEL}</p>
          </div>
          <button
            className="rail-toggle"
            onClick={() => update({ sidebarCollapsed: !prefs.sidebarCollapsed })}
            title={prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {prefs.sidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <button
          className={'btn primary block' + (drawing ? ' active' : '')}
          onClick={startDrawing}
          disabled={scanning}
          title={drawing ? 'Cancel drawing' : 'Draw a new box'}
        >
          {prefs.sidebarCollapsed ? '+' : drawing ? 'Cancel drawing' : '+ New box'}
        </button>

        <div className="terr-head">
          <span>Boxes</span>
          <span className="count">{territories.length}</span>
        </div>

        <ul className="terr-list">
          {territories.length === 0 && (
            <li className="empty">
              No boxes yet. Click <strong>New box</strong>, then press and drag on the map.
            </li>
          )}
          {territories.map((t) => (
            <li
              key={t.id}
              className={'terr-row' + (t.id === selectedId ? ' selected' : '')}
              style={{ ['--terr-color' as string]: territoryHex(t.color, resolvedTheme) }}
            >
              <button
                className={'terr' + (t.id === selectedId ? ' selected' : '')}
                onClick={() => setSelectedId(t.id)}
                title={t.name + ' · ' + t.leadCount + ' leads'}
              >
                <span className="terr-initial" aria-hidden="true">
                  {t.name.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="terr-name">{t.name}</span>
                <span className="terr-meta">
                  {t.leadCount} leads
                  {/* Three states, three readings. "412 leads · never scanned"
                      is what the old two-state check printed after a stop. */}
                  {territoryScanState(t) === 'complete'
                    ? ' · scanned ' + new Date(t.lastScanAt!).toLocaleDateString()
                    : territoryScanState(t) === 'partial'
                      ? ' · partial scan'
                      : ' · never scanned'}
                </span>
              </button>
              <TerritoryMenu
                colorKey={t.color}
                theme={resolvedTheme}
                onPick={(c) => void setTerritoryColor(t, c)}
                onDelete={() => void deleteTerritory(t)}
                busy={scanning && t.id === selectedId}
              />
            </li>
          ))}
        </ul>

        <button
          className="btn settings-btn"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          <span className="settings-icon" aria-hidden="true">⚙</span>
          {!prefs.sidebarCollapsed && <span>Settings</span>}
        </button>
      </aside>

      <main className="main" ref={mainRef}>
        {!prefs.mapClosed && (
          <>
            <MapPicker
              territories={territories}
              selectedId={selectedId}
              drawing={drawing}
              onDrawn={handleDrawn}
              onSelect={setSelectedId}
              heightPct={mapHeightPct}
              theme={resolvedTheme}
              onClose={() => update({ mapClosed: true })}
            />
            <MapResizer
              containerRef={mainRef}
              onResize={setMapHeightPct}
              onCommit={(pct) => update({ mapHeightPct: pct })}
            />
          </>
        )}

        {prefs.mapClosed && (
          <button className="map-reopen" onClick={() => update({ mapClosed: false })}>
            Show map
          </button>
        )}

        {selected && (
          <div className="detail">
            <div className="detail-head">
              <div>
                <h2>{selected.name}</h2>
                <p className="coords">
                  {formatBBox(selected.bbox)} · {Math.round(areaKm2(selected.bbox)).toLocaleString()} km²
                  {' · '}
                  {selectedZipCount} ZIP codes
                </p>
              </div>
              <div className="actions">
                {!scanning && leads.length > 0 && (
                  <button
                    className="btn"
                    onClick={() => findEmails(selected)}
                    title="Guesses each practice's website, then reads it for an email address. Slow — a few minutes per thousand leads."
                  >
                    Find emails
                    <span className="btn-sub">{leads.filter((l) => !l.email).length} without</span>
                  </button>
                )}
                {scanning ? (
                  <button className="btn danger" onClick={() => cancelRef.current?.cancel()}>
                    Stop
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => startScan(selected)}>
                    {/* Rescan is the recovery path after a stop, so a partial
                        box has to offer it - there is no Resume. */}
                    {territoryScanState(selected) === 'never' ? 'Find leads' : 'Rescan'}
                  </button>
                )}
                <button className="btn" onClick={exportCsv} disabled={!leads.length}>
                  Export CSV
                  {visible.length > 0 && visible.length !== leads.length && (
                    <span className="btn-sub">{visible.length.toLocaleString()} shown</span>
                  )}
                </button>
                <button className="btn ghost" onClick={() => deleteTerritory(selected)} disabled={scanning}>
                  Delete
                </button>
              </div>
            </div>

            {progress && (
              <div className={'progress ' + progress.phase}>
                <div className="progress-line">
                  <span>{progress.message}</span>
                  {progress.total > 0 && (
                    <span className="tnum">
                      {progress.current}/{progress.total} · {progress.leadsFound} leads
                    </span>
                  )}
                </div>
                {scanning && progress.total > 0 && (
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: (progress.current / progress.total) * 100 + '%' }}
                    />
                  </div>
                )}
              </div>
            )}

            {warnings.map((w, i) => (
              <p className="warn" key={i}>{w}</p>
            ))}

            <LeadTable
              leads={leads}
              onPatch={patchLead}
              scanState={territoryScanState(selected)}
              zipCount={selectedZipCount}
              onVisibleChange={setVisible}
            />
          </div>
        )}
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      {pendingBox && (
        <NameBoxDialog
          bbox={pendingBox}
          zipCount={pendingZipCount}
          defaultSpecialties={prefs.defaultSpecialties}
          onCancel={() => setPendingBox(null)}
          onCreate={createTerritory}
        />
      )}
    </div>
  );
}
