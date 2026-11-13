/*
  THE SHARED FILTER BAR (Assets / Class / Currency / Subcategory)

  Used by the Annual, Best To Worst, Monthly, Graphs and Correlations tabs, each of which puts its own
  extra controls inside it (passed as children). Its selections live in the main screen, so they are
  the same on every tab and survive switching between them.

  It used to be defined INSIDE the main screen, which made React treat it as a brand-new component on
  every render and rebuild it from scratch: an open list could reset, and a phone's slide-up panel
  replayed its animation. Defined here, once, React keeps it and only updates what changed.
*/
import React, { useEffect, useRef } from 'react';
import type { AssetLookup } from '@/lib/fetchData';

export type FilterDropdown = 'assets' | 'assetClass' | 'currency' | 'assetSubcategory' | null;

/** Everything the bar reads from the main screen (bundled there as filterBarProps). */
export interface FilterBarProps {
  assetLookup: AssetLookup[];
  selectedAssetTickers: string[]; setSelectedAssetTickers: (t: string[]) => void;
  selectedAssetClasses: string[]; setSelectedAssetClasses: (c: string[]) => void;
  selectedCurrencies: string[]; setSelectedCurrencies: (c: string[]) => void;
  selectedAssetSubcategories: string[]; setSelectedAssetSubcategories: (s: string[]) => void;
  openFilterDropdown: FilterDropdown; setOpenFilterDropdown: (d: FilterDropdown) => void;
  getUniqueAssetClasses: () => string[];
  getUniqueCurrencies: () => string[];
  getUniqueAssetSubcategories: () => string[];
  toggleAllAssets: (selectAll: boolean) => void;
  toggleAllAssetClasses: (selectAll: boolean) => void;
  toggleAllCurrencies: (selectAll: boolean) => void;
  toggleAllAssetSubcategories: (selectAll: boolean) => void;
}

export default function AssetFilterControls({
  children, assetLookup, selectedAssetTickers, setSelectedAssetTickers, selectedAssetClasses, setSelectedAssetClasses,
  selectedCurrencies, setSelectedCurrencies, selectedAssetSubcategories, setSelectedAssetSubcategories,
  openFilterDropdown, setOpenFilterDropdown, getUniqueAssetClasses, getUniqueCurrencies, getUniqueAssetSubcategories,
  toggleAllAssets, toggleAllAssetClasses, toggleAllCurrencies, toggleAllAssetSubcategories,
}: FilterBarProps & { children?: React.ReactNode }) {
  // Ref for click-outside detection
  const filterRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // A tap inside the phone's slide-up panel isn't "outside": the panel lives elsewhere on the page
      if ((event.target as Element).closest?.('[role="dialog"]')) return;
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setOpenFilterDropdown(null);
      }
    };

    // Only add listener when a dropdown is open
    if (openFilterDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [openFilterDropdown, setOpenFilterDropdown]);

  // Get the unique values for each dropdown
  const assetClasses = getUniqueAssetClasses();
  const currencies = getUniqueCurrencies();
  const assetSubcategories = getUniqueAssetSubcategories();

  // Check if all items are selected (to show "Deselect All" vs "Select All")
  const allAssetsSelected = selectedAssetTickers.length === assetLookup.length;
  const allClassesSelected = selectedAssetClasses.length === assetClasses.length;
  const allCurrenciesSelected = selectedCurrencies.length === currencies.length;
  const allSubcategoriesSelected = selectedAssetSubcategories.length === assetSubcategories.length;

  // Helper to get display text for the dropdown button
  const getSelectionText = (selected: number, total: number, label: string) => {
    if (selected === total) return 'All';
    if (selected === 0) return `No ${label}`;
    return `${selected} of ${total}`;
  };

  // PHONES: the four filter buttons become two-line boxes on a 2×2 grid, like the other choice
  // boxes on a phone ("phone-filter-grid" / "phone-filter-box" in globals.css). Their checkbox
  // lists are hidden there ("max-md:hidden"): a phone gets the same list as a slide-up panel
  // instead, like every other choice (drawn next to <PhoneSelectSheets /> at the bottom).
  // On desktop the grid wrapper is "contents": it vanishes and the buttons sit in the row as before.
  return (
    <div ref={filterRef} className="flex flex-wrap gap-2 mb-4">
      <div className="contents phone-filter-grid">
      {/* Assets Dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assets' ? null : 'assets')}
          className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
            openFilterDropdown === 'assets' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
          }`}
        >
          <span className="font-medium">Assets<span className="max-md:hidden">:</span></span>
          <span className="text-gray-600">{getSelectionText(selectedAssetTickers.length, assetLookup.length, 'assets')}</span>
          <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assets' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {openFilterDropdown === 'assets' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[280px] max-md:hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
              <span className="text-sm font-medium text-gray-700">Select Assets</span>
              <button
                onClick={() => toggleAllAssets(!allAssetsSelected)}
                className="text-xs text-blue-600 hover:underline"
              >
                {allAssetsSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto p-2">
              {assetLookup.map(asset => (
                <label key={asset.ticker} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                  <input
                    type="checkbox"
                    checked={selectedAssetTickers.includes(asset.ticker)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAssetTickers([...selectedAssetTickers, asset.ticker]);
                      } else {
                        setSelectedAssetTickers(selectedAssetTickers.filter(t => t !== asset.ticker));
                      }
                    }}
                  />
                  <span>{asset.ticker} - {asset.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Asset Class Dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetClass' ? null : 'assetClass')}
          className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
            openFilterDropdown === 'assetClass' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
          }`}
        >
          <span className="font-medium">Class<span className="max-md:hidden">:</span></span>
          <span className="text-gray-600">{getSelectionText(selectedAssetClasses.length, assetClasses.length, 'classes')}</span>
          <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetClass' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {openFilterDropdown === 'assetClass' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[200px] max-md:hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
              <span className="text-sm font-medium text-gray-700">Select Classes</span>
              <button
                onClick={() => toggleAllAssetClasses(!allClassesSelected)}
                className="text-xs text-blue-600 hover:underline"
              >
                {allClassesSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto p-2">
              {assetClasses.map(assetClass => (
                <label key={assetClass} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                  <input
                    type="checkbox"
                    checked={selectedAssetClasses.includes(assetClass)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAssetClasses([...selectedAssetClasses, assetClass]);
                      } else {
                        setSelectedAssetClasses(selectedAssetClasses.filter(c => c !== assetClass));
                      }
                    }}
                  />
                  <span>{assetClass}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Currency Dropdown */}
      <div className="relative">
        <button
          onClick={() => setOpenFilterDropdown(openFilterDropdown === 'currency' ? null : 'currency')}
          className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
            openFilterDropdown === 'currency' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
          }`}
        >
          <span className="font-medium">Currency<span className="max-md:hidden">:</span></span>
          <span className="text-gray-600">{getSelectionText(selectedCurrencies.length, currencies.length, 'currencies')}</span>
          <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'currency' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {openFilterDropdown === 'currency' && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[160px] max-md:hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
              <span className="text-sm font-medium text-gray-700">Select Currencies</span>
              <button
                onClick={() => toggleAllCurrencies(!allCurrenciesSelected)}
                className="text-xs text-blue-600 hover:underline"
              >
                {allCurrenciesSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="max-h-60 overflow-y-auto p-2">
              {currencies.map(currency => (
                <label key={currency} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                  <input
                    type="checkbox"
                    checked={selectedCurrencies.includes(currency)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedCurrencies([...selectedCurrencies, currency]);
                      } else {
                        setSelectedCurrencies(selectedCurrencies.filter(c => c !== currency));
                      }
                    }}
                  />
                  <span>{currency}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Asset Subcategory Dropdown */}
      {assetSubcategories.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setOpenFilterDropdown(openFilterDropdown === 'assetSubcategory' ? null : 'assetSubcategory')}
            className={`phone-filter-box h-8 px-3 text-xs border rounded-lg flex items-center gap-2 max-md:h-auto max-md:py-1.5 max-md:text-sm ${
              openFilterDropdown === 'assetSubcategory' ? 'border-slate-400 bg-gray-100' : 'border-gray-300 bg-white hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">Subcategory<span className="max-md:hidden">:</span></span>
            <span className="text-gray-600">{getSelectionText(selectedAssetSubcategories.length, assetSubcategories.length, 'subcategories')}</span>
            <svg className={`w-4 h-4 transition-transform ${openFilterDropdown === 'assetSubcategory' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {openFilterDropdown === 'assetSubcategory' && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg min-w-[220px] max-md:hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Select Subcategories</span>
                <button
                  onClick={() => toggleAllAssetSubcategories(!allSubcategoriesSelected)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {allSubcategoriesSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto p-2">
                {assetSubcategories.map(subcategory => (
                  <label key={subcategory} className="flex items-center gap-2 py-1 px-2 text-sm cursor-pointer hover:bg-gray-100 rounded">
                    <input
                      type="checkbox"
                      checked={selectedAssetSubcategories.includes(subcategory)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAssetSubcategories([...selectedAssetSubcategories, subcategory]);
                        } else {
                          setSelectedAssetSubcategories(selectedAssetSubcategories.filter(s => s !== subcategory));
                        }
                      }}
                    />
                    <span>{subcategory}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Extra controls passed in as children (e.g., Years filter) — rendered after Subcategory */}
      {children}
    </div>
  );
}
