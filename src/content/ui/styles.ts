export const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.df-root {
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #0f172a;
}
.df-btn {
  position: fixed;
  width: var(--df-size, 44px);
  height: var(--df-size, 44px);
  border-radius: 50%;
  border: none;
  padding: 0;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #fff;
  background: #2563eb;
  box-shadow: 0 4px 14px rgba(15, 23, 42, .28), 0 1px 3px rgba(15, 23, 42, .2);
  opacity: 0;
  transform: scale(.85);
  pointer-events: none;
  transition: opacity .12s ease, transform .12s ease, background-color .15s ease;
  touch-action: none;
  user-select: none;
  -moz-user-select: none;
  outline: none;
}
.df-btn.df-visible { opacity: 1; transform: scale(1); pointer-events: auto; }
.df-btn.df-dragging { cursor: grabbing; transition: none; }
.df-btn svg { width: 55%; height: 55%; pointer-events: none; }
.df-btn::after {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 3px solid transparent;
  pointer-events: none;
}
.df-btn[data-phase="arming"]::after {
  border-color: rgba(37, 99, 235, .55);
  border-style: dashed;
  animation: df-spin 1.2s linear infinite;
}
.df-btn[data-phase="listening"] { background: #dc2626; }
.df-btn[data-phase="listening"]::after {
  border-color: rgba(220, 38, 38, .55);
  transform: scale(calc(1 + var(--df-level, 0) * .35));
  transition: transform .07s linear;
}
.df-btn[data-phase="listening"] { animation: df-pulse 1.6s ease-in-out infinite; }
.df-btn[data-phase="transcribing"], .df-btn[data-phase="inserting"] { background: #1d4ed8; }
.df-btn[data-phase="success"] { background: #16a34a; }
.df-btn[data-phase="error"] { background: #d97706; }
.df-spinner { animation: df-spin .9s linear infinite; transform-origin: center; }
@keyframes df-spin { to { transform: rotate(360deg); } }
@keyframes df-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, .45), 0 4px 14px rgba(15, 23, 42, .28); }
  50% { box-shadow: 0 0 0 8px rgba(220, 38, 38, 0), 0 4px 14px rgba(15, 23, 42, .28); }
}
@media (prefers-reduced-motion: reduce) {
  .df-btn, .df-btn::after { animation: none !important; transition: none !important; }
}
.df-tooltip, .df-toast, .df-menu {
  position: fixed;
  background: #0f172a;
  color: #f8fafc;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .3);
  max-width: 300px;
  z-index: 1;
}
.df-tooltip { padding: 6px 10px; pointer-events: none; }
.df-toast { padding: 8px 12px; pointer-events: none; }
.df-toast[data-variant="error"] { background: #92400e; }
.df-toast[data-variant="success"] { background: #166534; }
.df-menu { padding: 4px; min-width: 180px; }
.df-menu button {
  all: unset;
  display: block;
  width: 100%;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  color: inherit;
  box-sizing: border-box;
}
.df-menu button:hover, .df-menu button:focus-visible { background: #1e293b; }
.df-hidden { display: none !important; }
.df-sr { position: fixed; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@media (prefers-color-scheme: dark) {
  .df-tooltip, .df-toast, .df-menu { background: #f1f5f9; color: #0f172a; }
  .df-menu button:hover, .df-menu button:focus-visible { background: #e2e8f0; }
  .df-toast[data-variant="error"] { background: #fde68a; }
  .df-toast[data-variant="success"] { background: #bbf7d0; }
}
`;
