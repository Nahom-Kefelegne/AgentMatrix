// Shared CSS for the diff-core surface: review-comment glyphs/decorations,
// spinners, popover/modal animations, and the segmented/outline/icon buttons.
// Rendered once by whichever surface (embedded core or modal wrapper) hosts it.
export const DIFF_CORE_STYLE_CSS = `
  .review-comment-glyph {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    cursor: pointer !important;
  }
  .review-comment-glyph::before {
    content: '';
    display: block;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: #fbbf24;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E") center/contain no-repeat;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/%3E%3C/svg%3E") center/contain no-repeat;
  }
  .review-comment-glyph:hover::before { background: #fcd34d; }
  .review-comment-line {
    background: rgba(251, 191, 36, 0.10) !important;
    border-left: 2px solid rgba(251, 191, 36, 0.4) !important;
  }
  .review-comment-glyph--resolved {
    display: flex !important; align-items: center !important; justify-content: center !important; cursor: pointer !important;
  }
  .review-comment-glyph--resolved::before {
    content: ''; display: block; width: 16px; height: 16px; border-radius: 4px; background: #51cf66; opacity: 0.7;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E") center/contain no-repeat;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E") center/contain no-repeat;
  }
  .review-comment-line--resolved {
    background: rgba(81, 207, 102, 0.06) !important;
    border-left: 2px solid rgba(81, 207, 102, 0.3) !important;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes glass-in {
    from { opacity: 0; transform: scale(0.92) translateY(4px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes cv-modal-in {
    from { opacity: 0; transform: scale(0.98) translateY(6px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }
  /* Segmented toggle (Changes/Browse, Inline/Split) — matches app pill toggles */
  .cv-seg {
    padding: 5px 13px; font-size: 13px; font-weight: 600; border-radius: 6px;
    border: none; background: transparent; color: #71717a; cursor: pointer;
    font-family: inherit; transition: color 0.15s, background 0.15s;
  }
  .cv-seg:hover { color: #a1a1aa; }
  .cv-seg--active { background: #6366f1; color: #fff; box-shadow: 0 1px 4px rgba(99,102,241,0.4); }
  .cv-seg--active:hover { color: #fff; }
  /* Outline button (Change Root, Clear Tracked, Cancel) */
  .cv-btn-outline {
    padding: 5px 12px; border-radius: 7px; border: 1px solid #33333c;
    background: transparent; color: #a1a1aa; font-size: 14px; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
  }
  .cv-btn-outline:hover { border-color: #4a4a56; background: #1c1c22; color: #e4e4e7; }
  /* Icon/close button */
  .cv-icon-btn {
    width: 30px; height: 30px; border-radius: 8px; border: 1px solid #2a2a30;
    background: #1c1c22; color: #a1a1aa; font-size: 16px; line-height: 1;
    display: flex; align-items: center; justify-content: center; cursor: pointer;
    transition: all 0.15s;
  }
  .cv-icon-btn:hover { background: #26262e; color: #fafafa; border-color: #3a3a44; }
  /* File row in the changes/browse sidebar */
  .cv-row { transition: background 0.12s; }
  .cv-row:hover { background: #17171d; }
`;

export function DiffCoreStyles() {
  return <style>{DIFF_CORE_STYLE_CSS}</style>;
}
