/*
  THE BACKTEST TAB: PARAMETERS AND PORTFOLIOS

  The top of the Backtest tab: the date range and its quick presets, starting capital, rebalancing,
  withdrawal and inflation, then one card per portfolio (preset, assets, weights, cost, currency,
  CPI) and the Run Backtest button. The results under it are BacktestResults.tsx.

  Every value and every action here changes the main screen's portfolios and dates, which the
  results, the URL and the phone memory all read, so they stay in the main screen and are passed in.
*/
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { AssetRow, PresetPortfolio } from '@/lib/fetchData';
import type { DateRange, Portfolio, PortfolioAsset } from '@/lib/backtest';
import { PhoneChoice } from '@/components/PhoneSheet';
import { BTN_MAIN, BTN_SECOND, FIELD, FIELD_SM, PHONE_SCROLL_ROW, SEG, segBtn } from '@/components/ui';
import { CPI_OPTIONS, DATE_PRESETS, PORTFOLIO_CURRENCY_OPTIONS, describeFxConversion, type DatePreset } from '@/components/options';

export interface BacktestSetupProps {
  assetData: AssetRow[];
  selectedDateRange: DateRange;
  setSelectedStartDate: (d: string) => void;
  setSelectedEndDate: (d: string) => void;
  activeDatePreset: () => DatePreset | undefined;
  setDatePreset: (preset: DatePreset) => void;
  getLimitingAsset: () => { date: string; assetName: string } | null;
  startingCapital: number; setStartingCapital: (n: number) => void;
  rebalanceFreq: string; setRebalanceFreq: (f: string) => void;
  withdrawalRate: string; setWithdrawalRate: (r: string) => void;
  inflationRate: string; setInflationRate: (r: string) => void;
  portfolios: Portfolio[]; setPortfolios: (p: Portfolio[]) => void;
  presetPortfolios: PresetPortfolio[];
  numDrafts: { [key: string]: string };
  availableAssetsFiltered: string[];
  getAssetCurrency: (ticker: string) => string;
  getAssetDisplayName: (ticker: string) => string;
  getTotalWeight: (portfolio: Portfolio) => number;
  matchingPreset: (p: Portfolio) => PresetPortfolio | undefined;
  generatePortfolioName: (assets: PortfolioAsset[], inflationAdj?: string, baseCurrency?: string, presetName?: string) => string;
  applyPreset: (portfolioId: number, presetName: string) => void;
  addPortfolio: () => void;
  removePortfolio: (id: number) => void;
  handlePortfolioNameChange: (id: number, name: string) => void;
  addAssetToPortfolio: (portfolioId: number) => void;
  updateAsset: (portfolioId: number, assetIndex: number, field: 'asset' | 'weight' | 'costPct', value: string | number) => void;
  handleNumericAssetInput: (portfolioId: number, assetIndex: number, field: 'weight' | 'costPct', raw: string) => void;
  clearNumDraft: (portfolioId: number, assetIndex: number, field: 'weight' | 'costPct') => void;
  removeAsset: (portfolioId: number, assetIndex: number) => void;
  runBacktest: () => void;
}

export default function BacktestSetup({
  assetData, selectedDateRange, setSelectedStartDate, setSelectedEndDate, activeDatePreset, setDatePreset,
  getLimitingAsset, startingCapital, setStartingCapital, rebalanceFreq, setRebalanceFreq, withdrawalRate,
  setWithdrawalRate, inflationRate, setInflationRate, portfolios, setPortfolios, presetPortfolios, numDrafts,
  availableAssetsFiltered, getAssetCurrency, getAssetDisplayName, getTotalWeight, matchingPreset,
  generatePortfolioName, applyPreset, addPortfolio, removePortfolio, handlePortfolioNameChange,
  addAssetToPortfolio, updateAsset, handleNumericAssetInput, clearNumDraft, removeAsset, runBacktest,
}: BacktestSetupProps) {
  return (
    <>
      {/* Parameters Section */}
      <div className="mb-6 p-3 bg-gray-50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Parameters</h2>
          {(() => { const active = activeDatePreset(); return (<>
          {/* Quick date range presets (phones: one box that opens a slide-up panel) */}
          <div className="hidden max-md:flex w-40">
            <PhoneChoice
              label="Quick range"
              display={active ?? 'Choose…'}
              subtitle="Sets start and end date"
              options={DATE_PRESETS.map(p => ({ value: p, label: p }))}
              selected={active}
              onPick={p => setDatePreset(p as DatePreset)}
            />
          </div>
          {/* The preset matching the dates on screen is the chosen one (slate); after
              picking dates by hand none is */}
          <div className={`flex gap-1 ${PHONE_SCROLL_ROW} max-md:hidden`}>
            <span className={SEG}>
            {DATE_PRESETS.map(preset => (
              <button
                key={preset}
                onClick={() => setDatePreset(preset)}
                className={segBtn(preset === active)}
              >
                {preset}
              </button>
            ))}
            </span>
          </div>
          </>); })()}
        </div>
        {/* Phones: two to a row (three cut the dates off: "2009-12-…"), and the boxes a
            little taller and rounder so they are easier to tap ("max-md:" classes) */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 max-md:grid-cols-2">
          {/* Start Date — filtered to only dates >= limiting asset's first available date */}
          {(() => {
            const limiting = getLimitingAsset();
            const minDate = limiting?.date || '';
            return (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
                <select
                  value={selectedDateRange.start}
                  onChange={(e) => setSelectedStartDate(e.target.value)}
                  className={`w-full ${FIELD}`}
                >
                  {assetData.filter(row => !minDate || row.date >= minDate).map(row => (
                    <option key={row.date} value={row.date}>{row.date}</option>
                  ))}
                </select>
                {limiting && (
                  <p className="text-[10px] text-amber-600 mt-0.5" title={`${limiting.assetName} has data from ${limiting.date}`}>
                    Limited by {limiting.assetName}
                  </p>
                )}
              </div>
            );
          })()}

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">End Date</label>
            <select
              value={selectedDateRange.end}
              onChange={(e) => setSelectedEndDate(e.target.value)}
              className={`w-full ${FIELD}`}
            >
              {assetData.slice().reverse().filter(row => row.date >= selectedDateRange.start).map(row => (
                <option key={row.date} value={row.date}>{row.date}</option>
              ))}
            </select>
          </div>

          {/* Starting Capital */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Capital ($)</label>
            <input
              type="number"
              value={startingCapital}
              onChange={(e) => setStartingCapital(parseFloat(e.target.value))}
              className={`w-full ${FIELD}`}
            />
          </div>

          {/* Rebalance Frequency */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rebalance</label>
            <select
              value={rebalanceFreq}
              onChange={(e) => setRebalanceFreq(e.target.value)}
              className={`w-full ${FIELD}`}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
              {/* "Never" = buy the target weights once on day one and never touch them again.
                  With leverage this is the "take the leverage once and let it ride" case:
                  the leverage ratio then floats freely instead of being reset. */}
              <option value="never">Never (buy &amp; hold)</option>
            </select>
          </div>

          {/* Withdrawal Rate - annual % withdrawn from portfolio (e.g., for retirement spending) */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Withdrawal (%)</label>
            <select
              value={withdrawalRate}
              onChange={(e) => setWithdrawalRate(e.target.value)}
              className={`w-full ${FIELD}`}
            >
              <option value="2">2.0%</option>
              <option value="2.5">2.5%</option>
              <option value="3">3.0%</option>
              <option value="3.5">3.5%</option>
              <option value="4">4.0%</option>
              <option value="4.5">4.5%</option>
              <option value="5">5.0%</option>
            </select>
          </div>

          {/* Inflation Rate - compounds the withdrawal upward each year to maintain purchasing power */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Inflation (%)</label>
            <select
              value={inflationRate}
              onChange={(e) => setInflationRate(e.target.value)}
              className={`w-full ${FIELD}`}
            >
              <option value="0">0%</option>
              <option value="1">1%</option>
              <option value="2">2%</option>
              <option value="3">3%</option>
              <option value="4">4%</option>
              <option value="5">5%</option>
              <option value="6">6%</option>
              <option value="7">7%</option>
            </select>
          </div>
        </div>
      </div>

      {/* Portfolios Section */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold text-gray-700">Portfolios</h2>
          <button
            onClick={addPortfolio}
            className={BTN_SECOND}
          >
            <Plus className="w-4 h-4" />Add
          </button>
        </div>

        {/* Portfolio Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {portfolios.map(portfolio => {
            const totalWeight = getTotalWeight(portfolio);
            const isValid = Math.abs(totalWeight - 100) < 0.01;
            // Leverage read-out. Net still has to be 100% (that's your own money), but the
            // long and short legs tell you how much market you're really standing on top of.
            const longExposure = portfolio.assets.reduce((s, a) => s + Math.max(0, a.weight || 0), 0);
            const shortExposure = portfolio.assets.reduce((s, a) => s + Math.min(0, a.weight || 0), 0);
            const isLevered = shortExposure < 0;

            return (
              <div key={portfolio.id} className="border-2 border-gray-200 rounded-lg p-3">
                {/* Portfolio Name & Delete */}
                <div className="flex justify-between items-center mb-2">
                  <input
                    type="text"
                    value={portfolio.name}
                    onChange={(e) => handlePortfolioNameChange(portfolio.id, e.target.value)}
                    className="font-semibold text-gray-800 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none flex-1 text-sm"
                  />
                  {portfolios.length > 1 && (
                    <button
                      onClick={() => removePortfolio(portfolio.id)}
                      className="text-red-500 hover:text-red-700 ml-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Preset picker — fills the card from the Portfolios sheet. Shows the preset
                    while the card still matches it, and "Custom" once anything is edited. */}
                {presetPortfolios.length > 0 && (() => {
                  const current = matchingPreset(portfolio);
                  // Preset tickers the asset dropdown can't show (not in the lookup table)
                  const unknown = current ? current.assets.map(a => a.asset).filter(t => !availableAssetsFiltered.includes(t)) : [];
                  return (
                    <div className="mb-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500 shrink-0">Preset:</span>
                        <select
                          value={current?.name ?? ''}
                          onChange={(e) => applyPreset(portfolio.id, e.target.value)}
                          className={`flex-1 min-w-0 ${FIELD_SM}`}
                          title="Load a ready-made portfolio from the Portfolios sheet. Replaces this card's assets and weights; currency and inflation stay as set."
                        >
                          <option value="">Custom</option>
                          {presetPortfolios.map(pp => (
                            <option key={pp.name} value={pp.name}>{pp.name}</option>
                          ))}
                        </select>
                      </div>
                      {unknown.length > 0 && (
                        <div className="text-[10px] text-red-600 mt-0.5">
                          Not in the asset list: {unknown.join(', ')} — check the ticker in the Portfolios sheet
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Asset List */}
                <div className="space-y-2 mb-2">
                  {/* Column labels — only worth the space once there's at least one asset */}
                  {portfolio.assets.length > 0 && (
                    <div className="flex gap-1 items-center text-[10px] text-gray-400 leading-none">
                      <span className="flex-1 min-w-0">Asset</span>
                      <span className="w-14 shrink-0 text-center" title="Weight %. Negative = short (e.g. -100 finances a 200% long).">Wgt %</span>
                      <span className="w-14 shrink-0 text-center" title="Annual carry on this leg's notional. Negative = a cost you pay (e.g. -0.5 = 50bps borrow spread on a short, or an ETF expense ratio on a long). Positive = income.">Cost %</span>
                      <span className="w-3 shrink-0 max-md:w-8" />
                    </div>
                  )}
                  {portfolio.assets.map((asset, idx) => {
                    // Keys into numDrafts — the raw text the user may be part-way through typing
                    const wKey = `${portfolio.id}:${idx}:weight`;
                    const cKey = `${portfolio.id}:${idx}:costPct`;
                    const isShort = (asset.weight || 0) < 0;
                    return (
                    <div key={idx} className="flex gap-1 items-center">
                      {/* Asset Selector - min-w-0 allows shrinking, flex-1 fills remaining space */}
                      <select
                        aria-label="Asset"
                        value={asset.asset}
                        onChange={(e) => updateAsset(portfolio.id, idx, 'asset', e.target.value)}
                        className={`flex-1 min-w-0 ${FIELD_SM}`}
                      >
                        <option value="">Select...</option>
                        {availableAssetsFiltered.map(a => (
                          <option key={a} value={a}>{getAssetDisplayName(a)}</option>
                        ))}
                      </select>
                      {/* Weight Input — type="text" (not "number") so a lone "-" can be typed;
                          the draft mechanism keeps it on screen until a full number is entered.
                          Short legs go red so leverage is obvious at a glance. */}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numDrafts[wKey] ?? String(asset.weight)}
                        onChange={(e) => handleNumericAssetInput(portfolio.id, idx, 'weight', e.target.value)}
                        onBlur={() => clearNumDraft(portfolio.id, idx, 'weight')}
                        placeholder="%"
                        title="Weight %. Negative = short this asset (e.g. 200 CSPX / -100 IB01)."
                        className={`w-14 h-[26px] px-1 text-xs border rounded-md bg-white shrink-0 text-right max-md:h-9 ${isShort ? 'border-red-300 text-red-600 font-semibold' : 'border-gray-300'}`}
                      />
                      {/* Cost Input — optional annual carry on this leg */}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={numDrafts[cKey] ?? (asset.costPct ? String(asset.costPct) : '')}
                        onChange={(e) => handleNumericAssetInput(portfolio.id, idx, 'costPct', e.target.value)}
                        onBlur={() => clearNumDraft(portfolio.id, idx, 'costPct')}
                        placeholder="—"
                        title="Annual carry on this leg, as % of its notional. Negative = you pay (e.g. -0.5 for a 50bps borrow spread). Leave empty for none."
                        className={`w-14 h-[26px] px-1 text-xs border rounded-md bg-white shrink-0 text-right max-md:h-9 ${asset.costPct ? 'border-amber-300 text-amber-700' : 'border-gray-200 text-gray-500'}`}
                      />
                      {/* Remove Asset. Phones: a 32px button around a bigger bin, so a finger can
                          hit it (the bare 12px icon was too small) */}
                      <button
                        onClick={() => removeAsset(portfolio.id, idx)}
                        aria-label="Remove asset"
                        className="text-red-500 hover:text-red-700 shrink-0 max-md:w-8 max-md:h-8 max-md:flex max-md:items-center max-md:justify-center"
                      >
                        <Trash2 className="w-3 h-3 max-md:w-4 max-md:h-4" />
                      </button>
                    </div>
                    );
                  })}
                </div>

                {/* Add Asset Button */}
                <button
                  onClick={() => addAssetToPortfolio(portfolio.id)}
                  className={`w-full ${BTN_SECOND}`}
                >
                  + Add Asset
                </button>

                {/* Weight Validation + Currency + Inflation Adjustment. Phones: the total on its
                    own line, then Ccy and Infl sharing the next one at full width (squeezed
                    onto one line, "Infl" got a 44px box) */}
                <div className="mt-2 flex items-center justify-between max-md:flex-col max-md:items-stretch max-md:gap-2">
                  <div className={`text-xs font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                    Total: {totalWeight.toFixed(0)}% {isValid ? '✓' : '(need 100%)'}
                    {isLevered && (
                      <div
                        className="text-[10px] font-normal text-gray-500 mt-0.5"
                        title="Net weight is still 100% (your own capital). Gross is how much market the portfolio actually holds; leverage = long exposure per unit of capital."
                      >
                        Long {longExposure.toFixed(0)}% / Short {Math.abs(shortExposure).toFixed(0)}% · {(longExposure / 100).toFixed(1)}× levered
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 max-md:w-full">
                    {/* Base Currency selector — converts all assets to the chosen currency */}
                    <div className="flex items-center gap-1 max-md:flex-1">
                      <span className="text-xs text-gray-500" title={describeFxConversion(portfolio.assets, portfolio.baseCurrency, getAssetCurrency)}>Ccy:</span>
                      <select
                        aria-label="Currency"
                        value={portfolio.baseCurrency}
                        onChange={(e) => {
                          const newCcy = e.target.value;
                          setPortfolios(portfolios.map(p => {
                            if (p.id === portfolio.id) {
                              const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(p.assets, p.inflationAdj, newCcy, matchingPreset(p)?.name);
                              return { ...p, baseCurrency: newCcy, name: newName };
                            }
                            return p;
                          }));
                        }}
                        className={`${FIELD_SM} max-md:flex-1 max-md:min-w-0`}
                        title={describeFxConversion(portfolio.assets, portfolio.baseCurrency, getAssetCurrency)}
                      >
                        {PORTFOLIO_CURRENCY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    {/* CPI Inflation Adjustment selector */}
                    <div className="flex items-center gap-1 max-md:flex-1">
                      <span className="text-xs text-gray-500" title="Adjust portfolio values for inflation using CPI data">Infl:</span>
                      <select
                        aria-label="Inflation adjustment"
                        value={portfolio.inflationAdj}
                        onChange={(e) => {
                          const newInflAdj = e.target.value;
                          setPortfolios(portfolios.map(p => {
                            if (p.id === portfolio.id) {
                              const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(p.assets, newInflAdj, p.baseCurrency, matchingPreset(p)?.name);
                              return { ...p, inflationAdj: newInflAdj, name: newName };
                            }
                            return p;
                          }));
                        }}
                        className={`${FIELD_SM} max-md:flex-1 max-md:min-w-0`}
                        title="Inflation adjustment: divides portfolio values by CPI to show real purchasing power"
                      >
                        {CPI_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Run Backtest Button */}
        <button
          onClick={runBacktest}
          className={`mt-4 w-full ${BTN_MAIN}`}
        >
          Run Backtest
        </button>
      </div>
    </>
  );
}
