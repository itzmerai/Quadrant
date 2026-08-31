import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CancelToken,
  areaKm2,
  formatBBox,
  leadsToCsv,
  loadZipIndex,
  runScan,
  guessWebsites,
  crawlForEmails,
  suggestFilename,
  zipsInBBox,
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
import { NameBoxDialog } from './components/NameBoxDialog';
import { LeadTable } from './components/LeadTable';
import { getFs, getHttp, STORAGE_LABEL } from './lib/runtime';

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

      const report = await store.mergeLeads(territory.id, result.leads);
      const updated: Territory = {
        ...territory,
        lastScanAt: new Date().toISOString(),
        leadCount: report.total,
      };
      await store.saveTerritory(updated);

      setTerritories(await store.listTerritories());
      setLeads(await store.getLeads(territory.id));
      setWarnings(result.warnings);
      setProgress({
        phase: 'done',
        message:
          report.added + ' new, ' + report.updated + ' updated, ' + report.total + ' total',
        current: 1, total: 1, leadsFound: report.total,
      });
    } catch (err) {
      const cancelled = cancel.cancelled;
      setProgress({
        phase: cancelled ? 'cancelled' : 'error',
        message: cancelled ? 'Scan cancelled' : String(err),
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
    setWarnings([]);
    const cancel = new CancelToken();
    cancelRef.current = cancel;

    const before = leads.filter((l) => l.email).length;
    try {
      const http = await getHttp();
      const guessed = await guessWebsites(leads, http, setProgress, cancel);
      const crawled = await crawlForEmails(guessed.leads, http, setProgress, cancel);

      await store.saveLeads(territory.id, crawled.leads);
      setLeads(crawled.leads);

      const gained = crawled.leads.filter((l) => l.email).length - before;
      setProgress({
        phase: 'done',
        message:
          'Found ' + gained + ' more emails · ' + guessed.resolved + ' websites guessed' +
          (guessed.rejected ? ' · ' + guessed.rejected + ' rejected as someone else' : ''),
        current: 1, total: 1, leadsFound: crawled.leads.length,
      });
    } catch (err) {
      setProgress({
        phase: cancel.cancelled ? 'cancelled' : 'error',
        message: cancel.cancelled ? 'Stopped — emails found so far are saved' : String(err),
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

  async function deleteTerritory(t: Territory) {
    if (!store) return;
    if (!confirm('Delete "' + t.name + '" and all ' + t.leadCount + ' of its leads?')) return;
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
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" width="30" height="30" />
          <div>
            <h1>Quadrant</h1>
            <p>{STORAGE_LABEL}</p>
          </div>
        </div>

        <button
          className={'btn primary block' + (drawing ? ' active' : '')}
          onClick={() => setDrawing((d) => !d)}
          disabled={scanning}
        >
          {drawing ? 'Cancel drawing' : '+ New box'}
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
            <li key={t.id}>
              <button
                className={'terr' + (t.id === selectedId ? ' selected' : '')}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="terr-name">{t.name}</span>
                <span className="terr-meta">
                  {t.leadCount} leads
                  {t.lastScanAt
                    ? ' · scanned ' + new Date(t.lastScanAt).toLocaleDateString()
                    : ' · never scanned'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="main">
        <MapPicker
          territories={territories}
          selectedId={selectedId}
          drawing={drawing}
          onDrawn={handleDrawn}
          onSelect={setSelectedId}
        />

        {selected && (
          <div className="detail">
            <div className="detail-head">
              <div>
                <h2>{selected.name}</h2>
                <p className="coords">
                  {formatBBox(selected.bbox)} · {Math.round(areaKm2(selected.bbox)).toLocaleString()} km²
                  {' · '}
                  {zipsInBBox(zipIndex, selected.bbox).length} ZIP codes
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
                    {selected.lastScanAt ? 'Rescan' : 'Find leads'}
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
              scanned={selected.lastScanAt !== null}
              zipCount={zipsInBBox(zipIndex, selected.bbox).length}
              onVisibleChange={setVisible}
            />
          </div>
        )}
      </main>

      {pendingBox && (
        <NameBoxDialog
          bbox={pendingBox}
          zipCount={zipsInBBox(zipIndex, pendingBox).length}
          onCancel={() => setPendingBox(null)}
          onCreate={createTerritory}
        />
      )}
    </div>
  );
}
