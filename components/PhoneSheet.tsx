'use client';

/*
  SLIDE-UP CHOICE PANELS (phones only)

  On a phone, picking a currency, a period or an asset opens a panel that slides up from the bottom
  of the screen with one big row per choice, the way phone apps do it, instead of a row of tiny
  buttons running off the edge or the browser's own dropdown list. Desktop never sees any of this.

  Three pieces:
    BottomSheet       the panel itself: dimmed page behind, a grab handle, a title, the list of
                      choices with a tick on the current one. Closes by tapping a choice, tapping
                      the dimmed page, or swiping the panel down.
    PhoneChoice       a box showing a setting and its current value ("Currency  USD ▾"); tapping it
                      opens the panel. Used in place of a row of option buttons, which is hidden on
                      phones (the row stays exactly as it was on desktop).
    PhoneSelectSheets mounted once for the whole app: on a phone, every dropdown (<select>) opens the
                      panel instead of the browser's own list, without changing any of them. It reads
                      the choices from the dropdown, and writes the chosen one back into it as if it
                      had been picked there, so the page reacts exactly as before.
*/

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SheetOption {
  value: string;
  label: string;
  hint?: string;      // small grey text after the label ("3 years")
  group?: string;     // a heading is drawn above the first choice of each group
  disabled?: boolean;
  icon?: React.ElementType; // a small icon before the label (the page menu)
  indent?: boolean;   // a sub-choice of the row above it, drawn indented and a little smaller
}

/** The small explanation after a period's name in a panel: "3Y" → "3 years", "YTD" → "since 1 Jan". */
export function periodHint(p: string): string | undefined {
  const m = /^(\d+)([YM])$/i.exec(p);
  if (m) {
    const n = Number(m[1]);
    return `${n} ${m[2].toUpperCase() === 'Y' ? 'year' : 'month'}${n === 1 ? '' : 's'}`;
  }
  if (p === 'YTD') return 'since 1 Jan';
  if (p.toLowerCase() === 'max') return 'all history';
  return undefined;
}

/** A list of periods ("1Y", "3Y", ...) as panel choices, each with its explanation. */
export const periodOptions = (periods: readonly string[], labels?: (p: string) => string): SheetOption[] =>
  periods.map(p => ({ value: p, label: labels ? labels(p) : p, hint: periodHint(p) }));

// Same width as Tailwind's "max-md:" classes, which every phone-only style in the app uses
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export function BottomSheet({ title, subtitle, options, selected, onPick, onClose, headerExtra, footer }: {
  title: string;
  subtitle?: string;
  options: SheetOption[];
  selected?: string;
  onPick: (value: string) => void;
  onClose: () => void;
  headerExtra?: React.ReactNode; // shown at the right of the title (e.g. the dark-mode button)
  footer?: React.ReactNode;      // a line kept under the list, which doesn't scroll with it
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // false while sliding in or out, true once in place (drives the slide and the dimming)
  const [shown, setShown] = useState(false);

  // Slide out, then really close (also used after a choice, so the panel doesn't just vanish)
  const close = () => {
    setShown(false);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    // Slide in: drawn first below the screen, then moved up on the next frame so it animates
    const frame = requestAnimationFrame(() => setShown(true));
    // Open with the current choice in view (a list of 200 months would otherwise open at the top)
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    // The page behind stays still while the panel is open, and pull-to-refresh is off
    // (it checks this flag), so a drag inside the panel can't scroll or refresh the page
    const body = document.body;
    const oldOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    body.dataset.sheetOpen = '1';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      body.style.overflow = oldOverflow;
      delete body.dataset.sheetOpen;
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swipe down to close: the panel follows the finger down; let go far enough and it closes,
  // otherwise it springs back. Only when the list is at its top (else the drag scrolls the list).
  const drag = useRef<{ startY: number; dy: number; active: boolean }>({ startY: 0, dy: 0, active: false });
  const onTouchStart = (e: React.TouchEvent) => {
    drag.current = { startY: e.touches[0].clientY, dy: 0, active: (listRef.current?.scrollTop ?? 0) <= 0 };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    if (!d.active || !sheetRef.current) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.startY);
    sheetRef.current.style.transition = 'none';
    sheetRef.current.style.transform = `translateY(${d.dy}px)`;
  };
  const onTouchEnd = () => {
    const d = drag.current;
    if (!d.active || !sheetRef.current) return;
    sheetRef.current.style.transition = '';
    sheetRef.current.style.transform = '';
    if (d.dy > 80) close();
    d.active = false;
  };

  let lastGroup: string | undefined;
  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        ref={sheetRef}
        className={`absolute inset-x-0 bottom-0 max-h-[80vh] flex flex-col bg-white rounded-t-2xl shadow-2xl transition-transform duration-200 ${shown ? 'translate-y-0' : 'translate-y-full'}`}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Grab handle and title */}
        <div className="shrink-0 pt-2 pb-2">
          <div className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-gray-300" />
          <div className="flex items-center justify-between gap-3 px-5 min-h-[28px]">
            <span className="text-[17px] font-semibold text-gray-900">{title}</span>
            {subtitle && <span className="text-[13px] text-gray-500 truncate">{subtitle}</span>}
            {headerExtra}
          </div>
        </div>
        {/* The choices; the list scrolls on its own when there are many (overscroll-contain stops
            the scroll from passing on to the page when it reaches the end) */}
        <div ref={listRef} className={`overflow-y-auto overscroll-contain ${footer ? '' : 'pb-[calc(0.75rem+env(safe-area-inset-bottom))]'}`}>
          {options.map(o => {
            const isSel = o.value === selected;
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            const Icon = o.icon;
            return (
              <React.Fragment key={o.value}>
                {heading && (
                  <div className="px-5 pt-4 pb-1.5 text-[11px] uppercase tracking-wider text-gray-500 border-t border-gray-200">{heading}</div>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  disabled={o.disabled}
                  onClick={() => { onPick(o.value); close(); }}
                  className={`w-full flex items-center justify-between gap-3 pr-5 text-left text-gray-900 disabled:opacity-40 ${
                    o.indent ? 'min-h-[44px] pl-[52px] text-[15px]' : 'min-h-[52px] pl-5 text-base border-t border-gray-200'
                  } ${isSel ? 'font-semibold' : ''}`}
                >
                  <span className="min-w-0 flex items-center gap-3">
                    {Icon && <Icon className="w-5 h-5 shrink-0 text-gray-500" />}
                    {o.label}
                    {o.hint && <span className="ml-2.5 text-[13px] font-normal text-gray-500">{o.hint}</span>}
                  </span>
                  {isSel && (
                    <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-slate-800 text-white flex items-center justify-center">
                      <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-gray-200 px-5 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A box showing a setting and its current value; tapping it opens the panel. Put it in a
 * "hidden max-md:flex" row so only phones see it, and give the button row it replaces
 * "max-md:hidden". `display` overrides the text shown in the box (e.g. for a row of actions
 * that has no current value).
 */
export function PhoneChoice({ label, options, selected, onPick, display, subtitle, variant }: {
  label: string;
  options: SheetOption[];
  selected?: string;
  onPick: (value: string) => void;
  display?: string;
  subtitle?: string;
  // 'filter' = one line, "Label: value ▾", in the style of the app's filter buttons
  // ("Assets: All assets ▾"), for sitting beside them
  variant?: 'filter';
}) {
  const [open, setOpen] = useState(false);
  const current = display ?? options.find(o => o.value === selected)?.label ?? '–';
  return (
    <>
      {variant === 'filter' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-1.5 text-sm border rounded-lg flex items-center gap-2 border-gray-300 bg-white"
        >
          <span className="font-medium">{label}:</span>
          <span className="text-gray-600">{current}</span>
          <ChevronDown className="w-4 h-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-1 min-w-0 flex flex-col items-start px-3 py-1.5 rounded-xl bg-gray-100 border border-gray-200 text-left"
        >
          <span className="text-[11px] leading-tight text-gray-500">{label}</span>
          <span className="w-full flex items-center justify-between gap-1 text-[15px] leading-snug font-semibold text-gray-900">
            <span className="truncate">{current}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-gray-500" />
          </span>
        </button>
      )}
      {open && (
        <BottomSheet
          title={label}
          subtitle={subtitle}
          options={options}
          selected={selected}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// The panel's title for a dropdown: its own label if it has one, else the short text just before
// it ("Start Date", "Ccy:"), else its tooltip
function selectTitle(sel: HTMLSelectElement): string {
  const prev = sel.previousElementSibling?.textContent?.trim();
  const raw = sel.getAttribute('aria-label')
    || sel.labels?.[0]?.textContent?.trim()
    || (prev && prev.length <= 40 ? prev : '')
    || sel.title
    || 'Choose';
  return raw.replace(/:\s*$/, '');
}

export function PhoneSelectSheets() {
  const [sel, setSel] = useState<HTMLSelectElement | null>(null);

  useEffect(() => {
    let start: { x: number; y: number; sel: HTMLSelectElement } | null = null;
    const selectOf = (target: EventTarget | null) => {
      const s = (target as Element | null)?.closest?.('select') as HTMLSelectElement | null;
      return s && !s.disabled && !s.multiple ? s : null;
    };
    // A finger tap on a dropdown: stop the browser's own list from opening, open the panel instead.
    // (Done when the finger lifts, and only if it hardly moved, so scrolling past a dropdown still scrolls.)
    const onTouchStart = (e: TouchEvent) => {
      const s = isPhone() ? selectOf(e.target) : null;
      start = s ? { x: e.touches[0].clientX, y: e.touches[0].clientY, sel: s } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
      const s = start.sel;
      start = null;
      if (moved > 10) return;
      e.preventDefault();
      setSel(s);
    };
    // Same for a mouse click on a phone-width screen (a desktop browser narrowed, or a phone
    // emulator); the touch path above already stops these on a real phone
    const onMouseDown = (e: MouseEvent) => {
      const s = isPhone() ? selectOf(e.target) : null;
      if (!s) return;
      e.preventDefault();
      setSel(s);
    };
    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    document.addEventListener('mousedown', onMouseDown, { capture: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
    };
  }, []);

  if (!sel) return null;
  const options: SheetOption[] = Array.from(sel.options).map(o => ({
    value: o.value,
    label: o.text,
    disabled: o.disabled,
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : undefined,
  }));
  return (
    <BottomSheet
      title={selectTitle(sel)}
      options={options}
      selected={sel.value}
      onPick={value => {
        // Put the choice into the dropdown the way the browser would, and announce it, so the
        // page's own onChange runs exactly as if it had been picked from the dropdown
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(sel, value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }}
      onClose={() => setSel(null)}
    />
  );
}
