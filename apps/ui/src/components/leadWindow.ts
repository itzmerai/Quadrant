/**
 * Which slice of a long list is actually on screen.
 *
 * Both lead views window their rendering — a metro box holds thousands of
 * practices and mounting them all froze the app once already. The list renders
 * one lead per row; the card grid renders several. That is the only difference,
 * so the arithmetic is shared and the views stay separate (KTD4).
 */

export interface WindowInput {
  /** Height of one row, in pixels. Rows are fixed-height in both views. */
  itemHeight: number;
  /** Leads per row. 1 for the list, the column count for the card grid. */
  perRow: number;
  /** Rows rendered beyond the viewport on each side. */
  overscan: number;
  count: number;
  scrollTop: number;
  viewportH: number;
}

export interface WindowResult {
  /** Index of the first lead to render. */
  first: number;
  /** Index one past the last lead to render. */
  last: number;
  /** Row the first lead sits on. */
  firstRow: number;
  padTop: number;
  padBottom: number;
  totalRows: number;
}

export function computeWindow(input: WindowInput): WindowResult {
  const perRow = Math.max(1, Math.floor(input.perRow));
  const itemHeight = Math.max(1, input.itemHeight);
  const count = Math.max(0, input.count);
  const scrollTop = Math.max(0, input.scrollTop);

  const totalRows = Math.ceil(count / perRow);

  if (count === 0) {
    return { first: 0, last: 0, firstRow: 0, padTop: 0, padBottom: 0, totalRows: 0 };
  }

  const firstRow = Math.max(0, Math.floor(scrollTop / itemHeight) - input.overscan);
  const visibleRows = Math.ceil(input.viewportH / itemHeight) + input.overscan * 2;
  const lastRow = Math.min(totalRows, firstRow + visibleRows);

  const first = Math.min(count, firstRow * perRow);
  const last = Math.min(count, lastRow * perRow);

  return {
    first,
    last,
    firstRow,
    padTop: firstRow * itemHeight,
    padBottom: Math.max(0, (totalRows - lastRow) * itemHeight),
    totalRows,
  };
}
