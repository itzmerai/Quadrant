import { describe, expect, it } from 'vitest';
import { computeWindow } from './leadWindow';

/**
 * The list view's current behavior is the baseline: one item per row, 46px
 * rows, 8 rows of overscan. Any change here must keep reproducing it.
 */
const LIST = { itemHeight: 46, perRow: 1, overscan: 8 };

describe('computeWindow', () => {
  it('starts at zero with no leading pad when unscrolled', () => {
    const w = computeWindow({ ...LIST, count: 1000, scrollTop: 0, viewportH: 600 });
    expect(w.first).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it('reproduces the list view indices at one item per row', () => {
    const w = computeWindow({ ...LIST, count: 1000, scrollTop: 460, viewportH: 600 });
    // 460/46 = row 10, minus 8 overscan = 2
    expect(w.first).toBe(2);
    expect(w.padTop).toBe(2 * 46);
  });

  it('maps a scroll offset to the right item range at three per row', () => {
    const w = computeWindow({ itemHeight: 200, perRow: 3, overscan: 2, count: 90, scrollTop: 1000, viewportH: 600 });
    // 1000/200 = row 5, minus 2 overscan = row 3 -> item 9
    expect(w.first).toBe(9);
    expect(w.firstRow).toBe(3);
  });

  it('ends exactly at the item count with no trailing pad at the bottom', () => {
    const w = computeWindow({ ...LIST, count: 100, scrollTop: 100 * 46, viewportH: 600 });
    expect(w.last).toBe(100);
    expect(w.padBottom).toBe(0);
  });

  it('includes the final partial row when the count does not divide evenly', () => {
    // 10 items at 3 per row = 4 rows, the last holding one item.
    const w = computeWindow({ itemHeight: 200, perRow: 3, overscan: 8, count: 10, scrollTop: 0, viewportH: 2000 });
    expect(w.last).toBe(10);
    expect(w.padBottom).toBe(0);
  });

  it('never returns a last index beyond the item count', () => {
    const w = computeWindow({ ...LIST, count: 5, scrollTop: 0, viewportH: 5000 });
    expect(w.last).toBe(5);
    expect(w.first).toBe(0);
  });

  it('clamps a negative scroll offset to the top', () => {
    const w = computeWindow({ ...LIST, count: 100, scrollTop: -300, viewportH: 600 });
    expect(w.first).toBe(0);
    expect(w.padTop).toBe(0);
  });

  it('handles an empty list without producing negative padding', () => {
    const w = computeWindow({ ...LIST, count: 0, scrollTop: 0, viewportH: 600 });
    expect(w.first).toBe(0);
    expect(w.last).toBe(0);
    expect(w.padTop).toBe(0);
    expect(w.padBottom).toBe(0);
  });

  it('keeps total padding plus rendered height equal to the full scroll extent', () => {
    const count = 500;
    const w = computeWindow({ ...LIST, count, scrollTop: 2000, viewportH: 600 });
    const renderedRows = Math.ceil((w.last - w.first) / LIST.perRow);
    const total = w.padTop + renderedRows * LIST.itemHeight + w.padBottom;
    expect(total).toBe(Math.ceil(count / LIST.perRow) * LIST.itemHeight);
  });
});
