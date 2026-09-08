import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  SPECIALTY_GROUPS,
  addNote,
  deleteNote,
  editNote,
  isOfficeHours,
  localTimeAt,
  scoreBand,
  type CallStatus,
  type Lead,
  type Note,
  type TerritoryScanState,
} from '@quadrant/core';
import { ExternalLink } from './ExternalLink';
import { LeadCards } from './LeadCards';
import { computeWindow } from './leadWindow';
import { usePreferences } from '../lib/PreferencesContext';
import { StatusPill, STATUSES, STATUS_LABEL } from './StatusPill';

interface Props {
  leads: Lead[];
  onPatch: (leadId: string, patch: Partial<Lead>) => void;
  /**
   * How far this box has been searched - three states, not two, because an
   * empty table means something different in each. A stop that found nothing
   * did not 'come back empty'; it was interrupted, and saying otherwise sends
   * her off to redraw a box that was fine.
   */
  scanState: TerritoryScanState;
  zipCount: number;
  /** Export follows what she is looking at, not the whole box. */
  onVisibleChange?: (visible: Lead[]) => void;
}


/**
 * Published beats guessed: a published address is safe to send to, a guessed
 * one can bounce, and bounces cost sender reputation. The distinction stays
 * visible on the row itself even though only these cuts are filterable.
 */
type ContactFilter = 'all' | 'email-any' | 'email-published' | 'site-any';

const CONTACT_OPTIONS: Array<{ value: ContactFilter; label: string }> = [
  { value: 'all', label: 'Any contact' },
  { value: 'email-any', label: 'Has email' },
  { value: 'email-published', label: 'Published email only' },
  { value: 'site-any', label: 'Has website' },
];

/**
 * The default row is what she reads while dialling: who, what number, who to
 * ask for, and whether they are open. Email and website are only in the way
 * until she is actually looking for them, so each column appears only when
 * its filter is on. Both are always in the expanded row and in the CSV.
 */
const EMAIL_FILTERS = new Set<ContactFilter>(['email-any', 'email-published']);
const SITE_FILTERS = new Set<ContactFilter>(['site-any']);

/** A domain reads better in a column than a full URL. */
function prettyDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] ?? url;
  }
}

function matchesContact(l: Lead, f: ContactFilter): boolean {
  switch (f) {
    case 'email-any':
      return !!l.email;
    case 'email-published':
      return !!l.email && l.emailConfidence === 'published';
    case 'site-any':
      return !!l.website;
    default:
      return true;
  }
}

/**
 * A metro box returns thousands of practices. Rendering them all put roughly
 * 56,000 nodes in the DOM and froze the window, so only the rows actually on
 * screen are mounted and the rest are represented by two spacer rows.
 *
 * Row height is pinned in CSS so this arithmetic stays exact.
 */
const ROW_H = 46;
const EXPANDED_H = 220;
const OVERSCAN = 8;

/** A note's own date, short enough to sit on one line beside its controls. */
function noteDate(iso: string): string {
  const d = new Date(iso);
  // A note migrated from a record with neither a call date nor a fetch date
  // says so rather than showing "Invalid Date" or today (KTD11).
  if (!iso || Number.isNaN(d.getTime())) return 'date unknown';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Ctrl/Cmd+Enter submits; plain Enter is a newline, because notes are call detail. */
function isSubmitChord(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey);
}

/**
 * The running note history for one lead (R7-R10, R16).
 *
 * All the list arithmetic is in core's notes.ts (KTD5); this owns nothing but
 * which box is open. Mounted with key={lead.id} so a half-typed note can never
 * carry across to a different practice.
 */
function LeadNotes({ lead, onPatch }: { lead: Lead; onPatch: Props['onPatch'] }) {
  const notes: Note[] = lead.callNotes ?? [];

  // Open on an empty history so the common case is one click, not two; every
  // later note goes through the explicit control (R8).
  const [adding, setAdding] = useState(notes.length === 0);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const addRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  // preventScroll: the row is already where she left it, and a focus-driven
  // scroll inside the virtualized table jumps her somewhere else entirely.
  useEffect(() => {
    if (adding) addRef.current?.focus({ preventScroll: true });
  }, [adding]);
  useEffect(() => {
    if (editingId) editRef.current?.focus({ preventScroll: true });
  }, [editingId]);

  function commitAdd() {
    const next = addNote(notes, draft);
    if (next !== notes) onPatch(lead.id, { callNotes: next });
    setDraft('');
    setAdding(false);
  }

  function commitEdit(id: string) {
    onPatch(lead.id, { callNotes: editNote(notes, id, editDraft) });
    setEditingId(null);
    setEditDraft('');
  }

  function remove(n: Note) {
    // Same guard as deleting a box: a note is written work, and there is no
    // undo behind it.
    const preview = n.text.length > 60 ? n.text.slice(0, 60) + '…' : n.text;
    if (!confirm('Delete this note?\n\n' + preview)) return;
    onPatch(lead.id, { callNotes: deleteNote(notes, n.id) });
    if (editingId === n.id) setEditingId(null);
  }

  return (
    <div className="ld-col grow notes-col">
      <h4>Call notes</h4>

      {notes.length > 0 ? (
        <ul className="notes-list">
          {notes.map((n) => {
            const when = noteDate(n.createdAt);
            return (
              <li key={n.id} className="note">
                {editingId === n.id ? (
                  <>
                    <textarea
                      ref={editRef}
                      className="note-input"
                      value={editDraft}
                      aria-label={'Edit note from ' + when}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (isSubmitChord(e)) { e.preventDefault(); commitEdit(n.id); }
                        if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                      }}
                    />
                    <div className="note-actions">
                      <button className="note-btn go" onClick={() => commitEdit(n.id)}>Save</button>
                      <button className="note-btn" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="note-text">{n.text}</p>
                    <div className="note-meta">
                      {/* An empty dateTime is invalid HTML, and a migrated note
                          with no sourceable date legitimately has one. */}
                      {n.createdAt ? (
                        <time className="note-date tnum" dateTime={n.createdAt}>{when}</time>
                      ) : (
                        <span className="note-date">{when}</span>
                      )}
                      <span className="note-actions">
                        <button
                          className="note-btn"
                          aria-label={'Edit note from ' + when}
                          onClick={() => { setEditingId(n.id); setEditDraft(n.text); }}
                        >Edit</button>
                        <button
                          className="note-btn danger"
                          aria-label={'Delete note from ' + when}
                          onClick={() => remove(n)}
                        >Delete</button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        !adding && <p className="muted note-none">No notes on this lead yet.</p>
      )}

      {adding ? (
        <div className="note-new">
          <textarea
            ref={addRef}
            className="note-input"
            value={draft}
            placeholder="What happened on the call?"
            aria-label="New note"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitChord(e)) { e.preventDefault(); commitAdd(); }
              if (e.key === 'Escape') { e.preventDefault(); setDraft(''); setAdding(false); }
            }}
          />
          <div className="note-actions">
            <button className="note-btn go" onClick={commitAdd}>Add note</button>
            {notes.length > 0 && (
              <button
                className="note-btn"
                onClick={() => { setDraft(''); setAdding(false); }}
              >Cancel</button>
            )}
            <span className="note-hint">Ctrl+Enter</span>
          </div>
        </div>
      ) : (
        <button className="note-btn add" onClick={() => setAdding(true)}>+ Add note</button>
      )}
    </div>
  );
}

export function LeadTable({ leads, onPatch, scanState, zipCount, onVisibleChange }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [status, setStatus] = useState<'all' | CallStatus>('all');
  const [contact, setContact] = useState<ContactFilter>('all');
  const [openHoursOnly, setOpenHoursOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const { prefs, update } = usePreferences();
  const hasLeads = leads.length > 0;

  /**
   * Measure the scroll viewport with a ResizeObserver.
   *
   * Doing this in an inline ref callback instead re-attached the ref on every
   * render and set state each time, which React correctly killed as an
   * infinite update loop.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = () => {
      const h = el.clientHeight;
      if (h) setViewportH((prev) => (prev === h ? prev : h));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasLeads]);

  // The clock only has to be right to the minute; recomputing it per row per
  // render was pure waste.
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const now = useMemo(() => new Date(), [minuteBucket]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (group !== 'all' && l.specialtyGroup !== group) return false;
      if (status !== 'all' && l.callStatus !== status) return false;
      if (!matchesContact(l, contact)) return false;
      if (openHoursOnly && isOfficeHours(l.timezone, prefs.callingWindow, now) !== true) return false;
      if (!q) return true;
      return (
        l.practiceName.toLowerCase().includes(q) ||
        (l.contactName ?? '').toLowerCase().includes(q) ||
        (l.city ?? '').toLowerCase().includes(q) ||
        (l.email ?? '').toLowerCase().includes(q) ||
        (l.phone ?? '').includes(q)
      );
    });
  }, [leads, query, group, status, contact, openHoursOnly, now, prefs.callingWindow]);

  /** Live counts, so the filter says what it will actually give her. */
  const contactCounts = useMemo(() => {
    let email = 0;
    let published = 0;
    for (const l of leads) {
      if (!l.email) continue;
      email++;
      if (l.emailConfidence !== 'guessed') published++;
    }
    return { email, published, site: leads.filter((l) => l.website).length };
  }, [leads]);

  useEffect(() => {
    onVisibleChange?.(filtered);
  }, [filtered, onVisibleChange]);

  const groupsPresent = useMemo(() => {
    const set = new Set(leads.map((l) => l.specialtyGroup));
    return SPECIALTY_GROUPS.filter((g) => set.has(g.key));
  }, [leads]);

  if (!leads.length) {
    return (
      <div className="table-empty">
        {scanState === 'partial' ? (
          <>
            <p><strong>The scan was stopped before it found anything.</strong></p>
            <p className="muted">Press Rescan to search this box again.</p>
          </>
        ) : scanState === 'complete' ? (
          <>
            <p><strong>This box came back empty.</strong></p>
            <p className="muted">
              {zipCount === 0
                ? 'No U.S. ZIP codes fall inside it — the registry covers the United States only.'
                : 'The ' + zipCount + ' ZIP codes here hold no practices in the specialties you picked. Try adding specialties, or drawing a larger box.'}
            </p>
          </>
        ) : (
          <>
            <p>No leads in this box yet.</p>
            <p className="muted">
              Run <strong>Find leads</strong> to search the provider registry.
            </p>
          </>
        )}
      </div>
    );
  }

  const expandedIndex = expanded ? filtered.findIndex((l) => l.id === expanded) : -1;

  // Shared with the card view so the two cannot drift apart (KTD4). The list
  // is simply the one-per-row case.
  const win = computeWindow({
    itemHeight: ROW_H,
    perRow: 1,
    overscan: OVERSCAN,
    count: filtered.length,
    scrollTop,
    viewportH,
  });
  const { first, last, padTop } = win;
  let padBottom = win.padBottom;
  // The one expanded row is taller, so keep the scroll extent honest.
  if (expandedIndex >= last) padBottom += EXPANDED_H;

  const windowed = filtered.slice(first, last);

  const showEmail = EMAIL_FILTERS.has(contact);
  const showSite = SITE_FILTERS.has(contact);
  // Score, Practice, Phone, Ask for, Their time, Specialty, Status
  const columnCount = 7 + (showEmail ? 1 : 0) + (showSite ? 1 : 0);

  return (
    <div className="leads">
      <div className="filters">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search practice, contact, city, phone, email"
          aria-label="Search leads"
        />
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Specialty">
          <option value="all">All specialties</option>
          {groupsPresent.map((g) => (
            <option key={g.key} value={g.key}>{g.label}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'all' | CallStatus)}
          aria-label="Call status"
        >
          <option value="all">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select
          value={contact}
          onChange={(e) => setContact(e.target.value as ContactFilter)}
          aria-label="Contact channel"
          className={contact === 'all' ? '' : 'active-filter'}
        >
          {CONTACT_OPTIONS.map((o) => {
            const n =
              o.value === 'email-any' ? contactCounts.email
              : o.value === 'email-published' ? contactCounts.published
              : o.value === 'site-any' ? contactCounts.site
              : null;
            return (
              <option key={o.value} value={o.value}>
                {o.label}{n === null ? '' : ' (' + n.toLocaleString() + ')'}
              </option>
            );
          })}
        </select>
        <label className="toggle">
          <input
            type="checkbox"
            checked={openHoursOnly}
            onChange={(e) => setOpenHoursOnly(e.target.checked)}
          />
          <span>Open now</span>
        </label>
        <div className="viewswitch" role="group" aria-label="Layout">
          <button
            className={'vs-btn' + (prefs.viewMode === 'list' ? ' on' : '')}
            onClick={() => update({ viewMode: 'list' })}
            title="Dense rows"
          >List</button>
          <button
            className={'vs-btn' + (prefs.viewMode === 'cards' ? ' on' : '')}
            onClick={() => update({ viewMode: 'cards' })}
            title="Roomier cards"
          >Cards</button>
        </div>
        <span className="filter-count tnum">
          {filtered.length.toLocaleString()} of {leads.length.toLocaleString()}
        </span>
      </div>

      {prefs.viewMode === 'cards' ? (
        <LeadCards
          leads={filtered}
          onPatch={onPatch}
          callingWindow={prefs.callingWindow}
          now={now}
        />
      ) : (
      <div
        className="tblwrap"
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table>
          <thead>
            <tr>
              <th className="c-score">Score</th>
              <th>Practice</th>
              <th>Phone</th>
              {showSite && <th>Website</th>}
              {showEmail && <th>Email</th>}
              <th>Ask for</th>
              <th>Their time</th>
              <th>Specialty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr className="spacer" style={{ height: padTop }}>
                <td colSpan={columnCount} />
              </tr>
            )}

            {windowed.map((l) => {
              const open = isOfficeHours(l.timezone, prefs.callingWindow, now);
              const isOpen = expanded === l.id;
              return (
                <Fragment key={l.id}>
                  <tr
                    className={'row ' + scoreBand(l.score) + (isOpen ? ' expanded' : '')}
                    onClick={() => setExpanded(isOpen ? null : l.id)}
                  >
                    <td className="c-score">
                      <span className={'score ' + scoreBand(l.score)}>{l.score}</span>
                    </td>
                    <td>
                      <span className="practice">
                        {l.practiceName}
                        {!!l.relatedCount && (
                          <span className="related" title={(l.relatedNames ?? []).join(', ')}>
                            +{l.relatedCount} at this number
                          </span>
                        )}
                      </span>
                      <span className="sub">{[l.city, l.state].filter(Boolean).join(', ')}</span>
                    </td>
                    <td className="tnum">
                      {l.phone
                        ? <a href={'tel:' + l.phone.replace(/\D/g, '')}>{l.phone}</a>
                        : <span className="muted">—</span>}
                    </td>
                    {showSite && (
                      <td className="c-site">
                        {l.website ? (
                          <ExternalLink href={l.website} title={l.website}>
                            {prettyDomain(l.website)}
                          </ExternalLink>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    {showEmail && (
                    <td className="c-email">
                      {l.email ? (
                        <a
                          href={'mailto:' + l.email}
                          className={l.emailConfidence === 'guessed' ? 'guessed' : ''}
                          title={
                            l.emailConfidence === 'guessed'
                              ? l.email + ' — not published on their site. The domain accepts mail, but this exact mailbox is unconfirmed.'
                              : l.email + ' — published on their website'
                          }
                        >
                          {l.email}
                        </a>
                      ) : l.contactFormUrl ? (
                        <ExternalLink href={l.contactFormUrl} className="formlink">contact form</ExternalLink>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    )}
                    <td>
                      {l.contactName ? (
                        <>
                          <span>{l.contactName}</span>
                          {l.contactTitle && <span className="sub">{l.contactTitle}</span>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="tnum">
                      {l.timezone
                        ? (
                          <span className={'clock' + (open ? ' open' : '')}>
                            {localTimeAt(l.timezone, now)}
                          </span>
                        )
                        : <span className="muted">—</span>}
                    </td>
                    <td className="sub">{l.specialty}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <StatusPill
                        value={l.callStatus}
                        onChange={(next) =>
                          onPatch(l.id, { callStatus: next, lastCalledAt: new Date().toISOString() })
                        }
                      />
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={columnCount}>
                        <div className="lead-detail">
                          <div className="ld-col">
                            <h4>Why this lead</h4>
                            <ul>
                              {l.scoreReasons.length
                                ? l.scoreReasons.map((r, i) => <li key={i}>{r}</li>)
                                : <li className="muted">No standout signals</li>}
                            </ul>
                          </div>
                          <div className="ld-col">
                            <h4>Details</h4>
                            <dl>
                              {l.contactPhone && l.contactPhone !== l.phone && (
                                <><dt>Direct line</dt><dd className="tnum">{l.contactPhone}</dd></>
                              )}
                              {l.address && (
                                <><dt>Address</dt><dd>{l.address}, {l.city} {l.state} {l.zip}</dd></>
                              )}
                              {l.website && (
                                <>
                                  <dt>Website</dt>
                                  <dd><ExternalLink href={l.website}>{l.website}</ExternalLink></dd>
                                </>
                              )}
                              {l.email && <><dt>Email</dt><dd>{l.email}</dd></>}
                              {l.enumeratedAt && <><dt>Practice since</dt><dd className="tnum">{l.enumeratedAt}</dd></>}
                              {l.recordUpdatedAt && <><dt>Record updated</dt><dd className="tnum">{l.recordUpdatedAt}</dd></>}
                              {!!l.relatedCount && (
                                <><dt>Also here</dt><dd>{(l.relatedNames ?? []).join(', ')}</dd></>
                              )}
                              <dt>NPI</dt><dd className="tnum">{l.sourceId}</dd>
                            </dl>
                          </div>
                          <LeadNotes key={l.id} lead={l} onPatch={onPatch} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}

            {padBottom > 0 && (
              <tr className="spacer" style={{ height: padBottom }}>
                <td colSpan={columnCount} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
