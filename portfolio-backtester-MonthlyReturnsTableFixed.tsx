import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';

const PortfolioBacktester = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [assetData, setAssetData] = useState(null);
  const [availableAssets, setAvailableAssets] = useState([]);
  const [portfolios, setPortfolios] = useState([
    { id: 1, name: 'Portfolio 1', assets: [], color: '#3b82f6', nameManuallyEdited: false }
  ]);
  const [startingCapital, setStartingCapital] = useState(10000);
  const [rebalanceFreq, setRebalanceFreq] = useState('yearly');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedStartDate, setSelectedStartDate] = useState('');
  const [selectedEndDate, setSelectedEndDate] = useState('');
  const [backtestResults, setBacktestResults] = useState(null);
  const [storageStatus, setStorageStatus] = useState('');

  // Load data from persistent storage on mount
  useEffect(() => {
    loadStoredData();
  }, []);

  const loadStoredData = async () => {
    setIsLoading(true);
    setStorageStatus('Loading saved data...');
    try {
      const result = await window.storage.get('portfolio-backtester-data', false);
      if (result && result.value) {
        const stored = JSON.parse(result.value);
        const sizeInMB = (new Blob([result.value]).size / (1024 * 1024)).toFixed(2);
        setAssetData(stored.data);
        setAvailableAssets(stored.assets);
        setDateRange({ start: stored.data[0].date, end: stored.data[stored.data.length - 1].date });
        setIsConnected(true);
        setStorageStatus(`✓ Loaded ${stored.assets.length} assets, ${stored.data.length} rows (${sizeInMB}MB)`);
      } else {
        setStorageStatus('No saved data. Please upload a CSV file.');
      }
    } catch (error) {
      console.log('No stored data found:', error);
      setStorageStatus('No saved data. Please upload a CSV file.');
    }
    setIsLoading(false);
  };

  const saveToStorage = async (data, assets) => {
    setStorageStatus('Saving data...');
    try {
      const dataToSave = { data, assets };
      const jsonString = JSON.stringify(dataToSave);
      const sizeInMB = (new Blob([jsonString]).size / (1024 * 1024)).toFixed(2);
      
      console.log(`Attempting to save ${sizeInMB}MB of data...`);
      
      if (sizeInMB > 4.5) {
        throw new Error(`Data too large (${sizeInMB}MB). Storage limit is ~5MB.`);
      }
      
      const result = await window.storage.set('portfolio-backtester-data', jsonString, false);
      
      if (!result) {
        throw new Error('Storage returned null - save may have failed');
      }
      
      setStorageStatus(`✓ Saved ${assets.length} assets, ${data.length} rows (${sizeInMB}MB)`);
      return true;
    } catch (error) {
      console.error('Failed to save:', error);
      setStorageStatus(`⚠ Save failed: ${error.message}`);
      return false;
    }
  };

  const clearStorage = async () => {
    if (!confirm('Are you sure you want to delete all saved data?')) return;
    try {
      await window.storage.delete('portfolio-backtester-data', false);
      setAssetData(null);
      setAvailableAssets([]);
      setIsConnected(false);
      setDateRange({ start: '', end: '' });
      setBacktestResults(null);
      setStorageStatus('Data cleared.');
    } catch (error) {
      console.error('Failed to clear:', error);
      setStorageStatus('⚠ Failed to clear data');
    }
  };

  const selectedDateRange = {
    start: selectedStartDate || dateRange.start,
    end: selectedEndDate || dateRange.end
  };

  const getAvailableAssetsForDateRange = () => {
    if (!assetData || !selectedDateRange.start) return availableAssets;
    const startIndex = assetData.findIndex(row => row.date === selectedDateRange.start);
    if (startIndex === -1) return availableAssets;
    return availableAssets.filter(asset => {
      const hasDataAtStart = assetData[startIndex][asset] && assetData[startIndex][asset] > 0;
      if (hasDataAtStart) return true;
      for (let i = Math.max(0, startIndex - 5); i < startIndex; i++) {
        if (assetData[i][asset] && assetData[i][asset] > 0) return true;
      }
      return false;
    });
  };

  const availableAssetsFiltered = getAvailableAssetsForDateRange();

  const generatePortfolioName = (assets) => {
    const validAssets = assets.filter(a => a.asset && a.weight > 0);
    if (validAssets.length === 0) return 'Portfolio';
    return validAssets.map(a => `${a.asset}${Math.round(parseFloat(a.weight))}`).join('-');
  };

  const handlePortfolioNameChange = (id, name) => {
    setPortfolios(portfolios.map(p => p.id === id ? { ...p, name, nameManuallyEdited: true } : p));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setIsLoading(true);
    setStorageStatus('Processing CSV...');
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csvText = e.target.result;
        const { data, assets } = parseSheetData(csvText);
        
        // Save to persistent storage
        const saved = await saveToStorage(data, assets);
        
        setAssetData(data);
        setAvailableAssets(assets);
        setIsConnected(true);
        if (data.length > 0) {
          setDateRange({ start: data[0].date, end: data[data.length - 1].date });
        }
        
        if (saved) {
          alert(`CSV uploaded and saved!\n${data.length} rows, ${assets.length} assets.\n\nThis data will now load automatically for anyone who opens this app.`);
        } else {
          alert(`CSV uploaded!\n${data.length} rows, ${assets.length} assets.\n\n⚠ Warning: Could not save to storage.`);
        }
      } catch (error) {
        alert(`Error: ${error.message}`);
        setStorageStatus('⚠ Error processing CSV');
      }
      setIsLoading(false);
    };
    reader.onerror = () => { alert('Error reading file'); setIsLoading(false); };
    reader.readAsText(file);
  };

  const parseSheetData = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) throw new Error('Not enough data');
    
    // Detect delimiter
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    
    // Parse headers using proper CSV parsing
    const headerValues = parseCSVLine(lines[0], delimiter);
    const numColumns = headerValues.length;
    
    const assetColumns = [];
    const assetColumnIndices = {};
    
    // First column should be date, rest are assets
    for (let i = 1; i < headerValues.length; i++) {
      const header = headerValues[i].trim();
      if (header && header.length > 0) {
        assetColumns.push(header);
        assetColumnIndices[header] = i;
      }
    }
    
    if (assetColumns.length === 0) throw new Error('No asset columns found.');
    
    console.log('Total columns in header:', numColumns);
    console.log('Asset columns found:', assetColumns.length);
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      
      const values = parseCSVLine(lines[i], delimiter);
      
      // Ensure we have enough columns
      while (values.length < numColumns) {
        values.push('');
      }
      
      if (values.length < 2) continue;
      const dateStr = values[0].trim();
      if (!dateStr) continue;
      
      const row = { date: dateStr };
      
      assetColumns.forEach((asset) => {
        const colIndex = assetColumnIndices[asset];
        if (colIndex >= values.length) return;
        
        const rawValue = values[colIndex].trim();
        
        if (!rawValue || rawValue === '') return;
        
        // Remove commas from numbers (e.g., "1,189" becomes "1189")
        const cleanValue = rawValue.replace(/,/g, '');
        const value = parseFloat(cleanValue);
        
        if (!isNaN(value) && value > 0) {
          row[asset] = value;
        }
      });
      
      if (Object.keys(row).length > 1) data.push(row);
    }
    
    if (data.length === 0) throw new Error('No valid data rows found.');
    
    console.log(`Parsed ${data.length} rows of data`);
    
    return { data, assets: assetColumns };
  };

  // Proper CSV line parser that handles quotes and commas inside quoted fields
  const parseCSVLine = (line, delimiter = ',') => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        // End of field
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add last field
    result.push(current);
    
    return result;
  };

  const addPortfolio = () => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const newId = Math.max(...portfolios.map(p => p.id), 0) + 1;
    setPortfolios([...portfolios, { id: newId, name: `Portfolio ${newId}`, assets: [], color: colors[portfolios.length % colors.length], nameManuallyEdited: false }]);
  };

  const removePortfolio = (id) => setPortfolios(portfolios.filter(p => p.id !== id));

  const addAssetToPortfolio = (portfolioId) => {
    const firstAvailableAsset = availableAssetsFiltered[0] || '';
    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        // First asset starts at 100%, subsequent assets start at 0%
        const isFirstAsset = p.assets.length === 0;
        const newAssets = [...p.assets, { asset: firstAvailableAsset, weight: isFirstAsset ? 100 : 0 }];
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  // Auto-adjust first asset weight to make total = 100%
  const autoAdjustFirstAsset = (assets) => {
    if (assets.length < 2) return assets;
    const otherAssetsWeight = assets.slice(1).reduce((sum, a) => sum + parseFloat(a.weight || 0), 0);
    const firstAssetWeight = Math.max(0, 100 - otherAssetsWeight);
    const newAssets = [...assets];
    newAssets[0] = { ...newAssets[0], weight: firstAssetWeight };
    return newAssets;
  };

  const updateAsset = (portfolioId, assetIndex, field, value) => {
    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = [...p.assets];
        newAssets[assetIndex] = { ...newAssets[assetIndex], [field]: value };
        // Auto-adjust first asset if we changed weight of any other asset
        if (field === 'weight' && assetIndex > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  const removeAsset = (portfolioId, assetIndex) => {
    setPortfolios(portfolios.map(p => {
      if (p.id === portfolioId) {
        let newAssets = p.assets.filter((_, i) => i !== assetIndex);
        // If we removed asset other than first, auto-adjust first asset
        if (assetIndex > 0 && newAssets.length > 0) {
          newAssets = autoAdjustFirstAsset(newAssets);
        }
        const newName = p.nameManuallyEdited ? p.name : generatePortfolioName(newAssets);
        return { ...p, assets: newAssets, name: newName };
      }
      return p;
    }));
  };

  const calculatePortfolioReturns = (portfolio, data) => {
    if (!portfolio.assets.length || !data.length) return null;
    const totalWeight = portfolio.assets.reduce((sum, a) => sum + parseFloat(a.weight || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) return null;
    const filteredData = data.filter(row => row.date >= selectedDateRange.start && row.date <= selectedDateRange.end);
    if (filteredData.length < 2) return null;
    
    // Initialize asset holdings based on target weights
    const targetWeights = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      targetWeights[asset] = parseFloat(weight) / 100;
    });
    
    // Calculate initial shares for each asset
    const assetShares = {};
    portfolio.assets.forEach(({ asset, weight }) => {
      const initialPrice = filteredData[0][asset];
      if (initialPrice && initialPrice > 0) {
        const initialAllocation = startingCapital * (parseFloat(weight) / 100);
        assetShares[asset] = initialAllocation / initialPrice;
      } else {
        assetShares[asset] = 0;
      }
    });
    
    const returns = [];
    let runningMax = startingCapital;
    let lastRebalanceDate = new Date(filteredData[0].date);
    
    for (let i = 0; i < filteredData.length; i++) {
      const row = filteredData[i];
      const currentDate = new Date(row.date);
      
      // Check if we need to rebalance
      let shouldRebalance = false;
      if (i > 0) {
        const monthsSinceRebalance = (currentDate.getFullYear() - lastRebalanceDate.getFullYear()) * 12 + 
                                     (currentDate.getMonth() - lastRebalanceDate.getMonth());
        
        if (rebalanceFreq === 'monthly' && monthsSinceRebalance >= 1) {
          shouldRebalance = true;
        } else if (rebalanceFreq === 'quarterly' && monthsSinceRebalance >= 3) {
          shouldRebalance = true;
        } else if (rebalanceFreq === 'yearly' && monthsSinceRebalance >= 12) {
          shouldRebalance = true;
        }
      }
      
      // Calculate current portfolio value
      let portfolioValue = 0;
      portfolio.assets.forEach(({ asset }) => {
        const currentPrice = row[asset];
        if (currentPrice && currentPrice > 0 && assetShares[asset]) {
          portfolioValue += assetShares[asset] * currentPrice;
        }
      });
      
      // Rebalance if needed
      if (shouldRebalance && portfolioValue > 0) {
        portfolio.assets.forEach(({ asset, weight }) => {
          const currentPrice = row[asset];
          if (currentPrice && currentPrice > 0) {
            const targetAllocation = portfolioValue * (parseFloat(weight) / 100);
            assetShares[asset] = targetAllocation / currentPrice;
          }
        });
        lastRebalanceDate = currentDate;
      }
      
      if (portfolioValue > runningMax) runningMax = portfolioValue;
      returns.push({ 
        date: row.date, 
        value: portfolioValue, 
        drawdown: ((portfolioValue - runningMax) / runningMax) * 100 
      });
    }
    
    return returns;
  };

  const calculateStatistics = (returns, portfolio) => {
    if (!returns || returns.length < 2) return null;
    const startValue = returns[0].value, endValue = returns[returns.length - 1].value;
    const totalReturn = ((endValue - startValue) / startValue) * 100;
    const startDate = new Date(returns[0].date), endDate = new Date(returns[returns.length - 1].date);
    const years = (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);
    const cagr = years > 0 ? (Math.pow(endValue / startValue, 1 / years) - 1) * 100 : 0;
    const periodicReturns = [];
    for (let i = 1; i < returns.length; i++) periodicReturns.push((returns[i].value - returns[i - 1].value) / returns[i - 1].value);
    const mean = periodicReturns.reduce((sum, r) => sum + r, 0) / periodicReturns.length;
    const variance = periodicReturns.map(r => Math.pow(r - mean, 2)).reduce((sum, sq) => sum + sq, 0) / periodicReturns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(12) * 100;
    const maxDrawdown = Math.min(...returns.map(r => r.drawdown));
    const currentDrawdown = returns[returns.length - 1].drawdown;
    const sharpeRatio = volatility > 0 ? cagr / volatility : 0;
    return { name: portfolio.name, totalReturn: totalReturn.toFixed(2), cagr: cagr.toFixed(2), volatility: volatility.toFixed(2), sharpeRatio: sharpeRatio.toFixed(2), maxDrawdown: maxDrawdown.toFixed(2), currentDrawdown: currentDrawdown.toFixed(2), endingValue: endValue.toFixed(2) };
  };

  const calculateMonthlyReturns = (returns) => {
    if (!returns || returns.length === 0) return {};
    
    const monthlyData = {};
    
    // Group data by year and month
    returns.forEach(point => {
      const date = new Date(point.date);
      const year = date.getFullYear();
      const month = date.getMonth();
      
      if (!monthlyData[year]) {
        monthlyData[year] = { monthly: Array(12).fill(null), yearStart: null, yearEnd: null };
      }
      
      // Track the last value of each month
      if (!monthlyData[year].monthly[month]) {
        monthlyData[year].monthly[month] = { endValue: point.value, startValue: null };
      }
      monthlyData[year].monthly[month].endValue = point.value;
      
      // Track year start and end values
      if (!monthlyData[year].yearStart) {
        monthlyData[year].yearStart = point.value;
      }
      monthlyData[year].yearEnd = point.value;
    });
    
    // Calculate monthly returns
    const years = Object.keys(monthlyData).sort();
    const result = {};
    
    years.forEach((year, yearIdx) => {
      const yearData = monthlyData[year];
      const monthlyReturns = Array(12).fill(null);
      
      let prevMonthEnd = yearIdx > 0 ? monthlyData[years[yearIdx - 1]].yearEnd : null;
      
      for (let month = 0; month < 12; month++) {
        if (yearData.monthly[month]) {
          const endValue = yearData.monthly[month].endValue;
          
          // Find start value (previous month's end or year's first value)
          let startValue = prevMonthEnd;
          if (month > 0) {
            // Look for previous month's end value
            for (let m = month - 1; m >= 0; m--) {
              if (yearData.monthly[m]) {
                startValue = yearData.monthly[m].endValue;
                break;
              }
            }
          }
          
          if (startValue && startValue > 0) {
            monthlyReturns[month] = ((endValue - startValue) / startValue) * 100;
          }
          
          prevMonthEnd = endValue;
        }
      }
      
      // Calculate FY return
      let fyReturn = 0;
      let fyStartValue = yearIdx > 0 ? monthlyData[years[yearIdx - 1]].yearEnd : yearData.yearStart;
      if (fyStartValue && fyStartValue > 0) {
        fyReturn = ((yearData.yearEnd - fyStartValue) / fyStartValue) * 100;
      }
      
      result[year] = {
        monthly: monthlyReturns,
        fy: fyReturn
      };
    });
    
    return result;
  };

  const runBacktest = () => {
    if (!assetData) { alert('Please upload CSV first'); return; }
    const results = portfolios.map(portfolio => {
      const returns = calculatePortfolioReturns(portfolio, assetData);
      const stats = calculateStatistics(returns, portfolio);
      return { portfolio, returns, stats };
    }).filter(r => r.returns !== null);
    if (results.length === 0) { alert('No valid portfolios. Check weights sum to 100%'); return; }
    setBacktestResults(results);
  };

  const getTotalWeight = (portfolio) => portfolio.assets.reduce((sum, a) => sum + parseFloat(a.weight || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-4 mb-4">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Portfolio Backtester</h1>
          
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">Data</h2>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="cursor-pointer inline-block">
                <div className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  {isConnected ? 'Update CSV' : 'Upload CSV'}
                </div>
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
              {isConnected && (
                <button onClick={clearStorage} className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 font-medium text-sm">
                  Clear Data
                </button>
              )}
            </div>
            <div className={`mt-3 text-sm ${storageStatus.startsWith('✓') ? 'text-green-600' : storageStatus.startsWith('⚠') ? 'text-orange-600' : 'text-gray-600'}`}>
              {isLoading ? '⏳ Loading...' : storageStatus}
            </div>
          </div>

          {isConnected && (
            <>
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h2 className="text-lg font-semibold text-gray-700 mb-3">Parameters</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <select value={selectedDateRange.start} onChange={(e) => setSelectedStartDate(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                      {assetData.map(row => (<option key={row.date} value={row.date}>{row.date}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <select value={selectedDateRange.end} onChange={(e) => setSelectedEndDate(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                      {assetData.slice().reverse().filter(row => row.date >= selectedDateRange.start).map(row => (<option key={row.date} value={row.date}>{row.date}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Starting Capital ($)</label>
                    <input type="number" value={startingCapital} onChange={(e) => setStartingCapital(parseFloat(e.target.value))} className="w-full px-2 py-1 border border-gray-300 rounded text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Rebalance</label>
                    <select value={rebalanceFreq} onChange={(e) => setRebalanceFreq(e.target.value)} className="w-full px-2 py-1 border border-gray-300 rounded text-sm">
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-lg font-semibold text-gray-700">Portfolios</h2>
                  <button onClick={addPortfolio} className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1 text-sm"><Plus className="w-4 h-4" />Add</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {portfolios.map(portfolio => {
                    const totalWeight = getTotalWeight(portfolio);
                    const isValid = Math.abs(totalWeight - 100) < 0.01;
                    return (
                      <div key={portfolio.id} className="border-2 border-gray-200 rounded-lg p-3">
                        <div className="flex justify-between items-center mb-2">
                          <input type="text" value={portfolio.name} onChange={(e) => handlePortfolioNameChange(portfolio.id, e.target.value)} className="font-semibold text-gray-800 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none flex-1 text-sm" />
                          {portfolios.length > 1 && (<button onClick={() => removePortfolio(portfolio.id)} className="text-red-500 hover:text-red-700 ml-2"><Trash2 className="w-4 h-4" /></button>)}
                        </div>
                        <div className="space-y-2 mb-2">
                          {portfolio.assets.map((asset, idx) => (
                            <div key={idx} className="flex gap-1">
                              <select value={asset.asset} onChange={(e) => updateAsset(portfolio.id, idx, 'asset', e.target.value)} className="flex-1 px-1 py-1 text-xs border border-gray-300 rounded">
                                <option value="">Select...</option>
                                {availableAssetsFiltered.map(a => (<option key={a} value={a}>{a}</option>))}
                              </select>
                              <input type="number" value={asset.weight} onChange={(e) => updateAsset(portfolio.id, idx, 'weight', e.target.value)} placeholder="%" className="w-14 px-1 py-1 text-xs border border-gray-300 rounded" />
                              <button onClick={() => removeAsset(portfolio.id, idx)} className="text-red-500 hover:text-red-700"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          ))}
                        </div>
                        <button onClick={() => addAssetToPortfolio(portfolio.id)} className="w-full py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded">+ Add Asset</button>
                        <div className={`mt-2 text-xs font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>Total: {totalWeight.toFixed(0)}% {isValid ? '✓' : '(need 100%)'}</div>
                      </div>
                    );
                  })}
                </div>
                <button onClick={runBacktest} className="mt-4 w-full py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700">Run Backtest</button>
              </div>
            </>
          )}

          {backtestResults && (
            <div className="mt-6">
              <h2 className="text-xl font-semibold text-gray-800 mb-4">Results</h2>
              <div className="bg-white p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Portfolio Value</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip formatter={(value) => `${value.toFixed(2)}`} />
                    <Legend />
                    {backtestResults.map((result, idx) => (<Line key={idx} data={result.returns} type="monotone" dataKey="value" name={result.portfolio.name} stroke={result.portfolio.color} strokeWidth={2} dot={false} />))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white p-4 rounded-lg shadow mb-4">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Drawdown</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(value) => `${value.toFixed(2)}%`} />
                    <Legend />
                    {backtestResults.map((result, idx) => (<Line key={idx} data={result.returns} type="monotone" dataKey="drawdown" name={result.portfolio.name} stroke={result.portfolio.color} strokeWidth={2} dot={false} />))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white p-4 rounded-lg shadow overflow-x-auto">
                <h3 className="text-md font-semibold text-gray-700 mb-2">Statistics</h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-2 px-2">Portfolio</th>
                      <th className="text-right py-2 px-2">Return</th>
                      <th className="text-right py-2 px-2">CAGR</th>
                      <th className="text-right py-2 px-2">Vol</th>
                      <th className="text-right py-2 px-2">Sharpe</th>
                      <th className="text-right py-2 px-2">Max DD</th>
                      <th className="text-right py-2 px-2">End $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backtestResults.map((result, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 px-2 font-medium" style={{ color: result.portfolio.color }}>{result.stats.name}</td>
                        <td className="text-right py-2 px-2">{result.stats.totalReturn}%</td>
                        <td className="text-right py-2 px-2">{result.stats.cagr}%</td>
                        <td className="text-right py-2 px-2">{result.stats.volatility}%</td>
                        <td className="text-right py-2 px-2">{result.stats.sharpeRatio}</td>
                        <td className="text-right py-2 px-2 text-red-600">{result.stats.maxDrawdown}%</td>
                        <td className="text-right py-2 px-2 font-semibold">${result.stats.endingValue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {backtestResults.map((result, idx) => {
                const monthlyReturns = calculateMonthlyReturns(result.returns);
                return (
                  <div key={idx} className="bg-white p-4 rounded-lg shadow overflow-x-auto mt-4">
                    <h3 className="text-md font-semibold mb-2" style={{ color: result.portfolio.color }}>
                      Returns - {result.portfolio.name}
                    </h3>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          <th className="text-left py-2 px-2 bg-gray-50 sticky left-0">Year</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jan</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Feb</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Mar</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Apr</th>
                          <th className="text-right py-2 px-2 bg-gray-50">May</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jun</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Jul</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Aug</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Sep</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Oct</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Nov</th>
                          <th className="text-right py-2 px-2 bg-gray-50">Dec</th>
                          <th className="text-right py-2 px-2 bg-gray-100 font-semibold">FY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(monthlyReturns).sort().map(year => (
                          <tr key={year} className="border-b border-gray-100">
                            <td className="py-2 px-2 font-medium bg-gray-50 sticky left-0">{year}</td>
                            {[0,1,2,3,4,5,6,7,8,9,10,11].map(month => {
                              const ret = monthlyReturns[year].monthly[month];
                              if (ret === null) return <td key={month} className="text-right py-2 px-2 text-gray-300">-</td>;
                              const bgColor = ret >= 0 ? 'bg-green-50' : 'bg-red-50';
                              const textColor = ret >= 0 ? 'text-green-700' : 'text-red-700';
                              return (
                                <td key={month} className={`text-right py-2 px-2 ${bgColor} ${textColor}`}>
                                  {ret.toFixed(2)}%
                                </td>
                              );
                            })}
                            <td className={`text-right py-2 px-2 font-semibold ${monthlyReturns[year].fy >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                              {monthlyReturns[year].fy.toFixed(2)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioBacktester;
