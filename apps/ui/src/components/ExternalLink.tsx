import type { ReactNode } from 'react';
import { IS_TAURI } from '../lib/runtime';

interface Props {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Opens a link in the user's real browser.
 *
 * A plain target="_blank" inside the Tauri webview can navigate the app itself
 * to the practice's website, which loses the call sheet. Going through the
 * opener plugin hands the URL to the OS instead.
 */
export function ExternalLink({ href, children, className, title }: Props) {
  async function handle(e: React.MouseEvent) {
    // Let the row's own click handler alone; this is a deliberate navigation.
    e.stopPropagation();
    if (!IS_TAURI) return; // plain browser: let the anchor do its job
    e.preventDefault();
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(href);
    } catch {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <a
      href={href}
      className={className}
      title={title}
      target="_blank"
      rel="noreferrer noopener"
      onClick={handle}
    >
      {children}
    </a>
  );
}
