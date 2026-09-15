import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Download,
  Share2,
  Maximize2,
  Check,
  ChevronRight,
  Sparkles,
  Layers,
  FileText,
  FileImage,
  RefreshCw,
  Eye,
  AlertCircle,
  Copy,
  CheckSquare,
  Square,
  Search,
  ExternalLink,
  CheckCircle2,
  FolderDown,
  Trash2,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ScreenId } from '../../types';
import {
  discoverAvailableInterfaces,
  getAllInterfaces,
  InterfaceMetadata,
  getInterfaceById,
  getSafeInterfaceFileName,
} from '../../lib/interfaceRegistry';
import {
  captureLiveCurrentInterface,
  captureInterfaceById,
  captureLiveInterfaceWithPanels,
  captureInterfaceByIdWithPanels,
  captureAllInterfaces,
  stitchCanvasesVertically,
  exportCapturesToPdf,
  triggerCaptureDownload,
  CapturedInterfaceResult,
  MultiCaptureReport,
  GeneratedResultFile,
  buildResultFileFromCapture,
  buildResultFileFromPdf,
  buildResultFileFromStitched,
  buildFailureResultFile,
} from '../../lib/interfaceCaptureEngine';

export const InterfaceCaptureScreen: React.FC = () => {
  const { currentScreen, showToast, requestConfirmation, previousScreen } = useApp();

  // Capture Configuration State
  const [captureScope, setCaptureScope] = useState<'current' | 'specific' | 'multiple' | 'all'>('current');
  const [selectedInterfaceId, setSelectedInterfaceId] = useState<string>('settings');
  const [selectedMultipleIds, setSelectedMultipleIds] = useState<string[]>(['axon', 'settings', 'tools']);
  const [captureType, setCaptureType] = useState<'visible' | 'full'>('full');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'long_image' | 'pdf'>('png');

  // Execution & Progress State
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number; interfaceName: string; percent: number } | null>(null);
  const [capturedResults, setCapturedResults] = useState<CapturedInterfaceResult[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedResultFile[]>([]);
  const [activePreviewFile, setActivePreviewFile] = useState<GeneratedResultFile | null>(null);
  const [multiReport, setMultiReport] = useState<MultiCaptureReport | null>(null);
  const [previewResult, setPreviewResult] = useState<CapturedInterfaceResult | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const resultsSectionRef = useRef<HTMLDivElement>(null);

  // Dynamic interface discovery
  const [availableInterfaces, setAvailableInterfaces] = useState<InterfaceMetadata[]>(() => getAllInterfaces());

  useEffect(() => {
    setAvailableInterfaces(discoverAvailableInterfaces());
  }, []);

  // Determine current screen name
  const currentMeta = getInterfaceById(previousScreen && previousScreen !== 'tool_interface_capture' ? previousScreen : currentScreen) || availableInterfaces[0];

  const handleToggleMultipleId = (id: string) => {
    setSelectedMultipleIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllMultiple = () => {
    if (selectedMultipleIds.length === availableInterfaces.length) {
      setSelectedMultipleIds([]);
    } else {
      setSelectedMultipleIds(availableInterfaces.map((i) => i.id));
    }
  };

  const handleExecuteCapture = async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    setProgress(null);

    const isFull = captureType === 'full';
    const imgFormat = exportFormat === 'jpeg' ? 'jpeg' : 'png';

    try {
      if (captureScope === 'current') {
        // Target previous screen if came from another tool, or current screen
        const targetRoute = previousScreen && previousScreen !== 'tool_interface_capture' ? previousScreen : currentScreen;
        const results = await captureLiveInterfaceWithPanels(targetRoute, {
          fullHeight: isFull,
          format: imgFormat,
        });

        const files: GeneratedResultFile[] = results.map((r) =>
          buildResultFileFromCapture(r, imgFormat === 'jpeg' ? 'jpg' : 'png')
        );

        if (exportFormat === 'pdf') {
          const pdfDoc = await exportCapturesToPdf(results, getSafeInterfaceFileName(results[0].name, 'pdf'));
          files.unshift(buildResultFileFromPdf(pdfDoc, results[0].name, results[0].category, results[0].route, results.length));
          triggerCaptureDownload(pdfDoc.dataUrl, pdfDoc.filename);
          showToast(`Exported ${results.length > 1 ? `${results.length}-page ` : ''}PDF document`);
        } else if (exportFormat === 'long_image' && results.length > 1) {
          const longImg = await stitchCanvasesVertically(results, { format: imgFormat });
          files.unshift(buildResultFileFromStitched(longImg, `Combined Interfaces (${results.length})`, 'Combined Long Image'));
          triggerCaptureDownload(longImg.dataUrl, longImg.filename);
          showToast(`Stitched & exported ${results.length} captures as Long Image`);
        } else {
          showToast(
            results.length > 1
              ? `Captured "${results[0].name}" + ${results.length - 1} panels`
              : `Captured "${results[0].name}" (${results[0].formattedSize})`
          );
        }

        setCapturedResults(results);
        setGeneratedFiles(files);
        setMultiReport(null);
        setTimeout(() => resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else if (captureScope === 'specific') {
        const results = await captureInterfaceByIdWithPanels(selectedInterfaceId, {
          fullHeight: isFull,
          format: imgFormat,
        });

        const files: GeneratedResultFile[] = results.map((r) =>
          buildResultFileFromCapture(r, imgFormat === 'jpeg' ? 'jpg' : 'png')
        );

        if (exportFormat === 'pdf') {
          const pdfDoc = await exportCapturesToPdf(results, getSafeInterfaceFileName(results[0].name, 'pdf'));
          files.unshift(buildResultFileFromPdf(pdfDoc, results[0].name, results[0].category, results[0].route, results.length));
          triggerCaptureDownload(pdfDoc.dataUrl, pdfDoc.filename);
          showToast(`Exported ${results.length > 1 ? `${results.length}-page ` : ''}PDF document`);
        } else if (exportFormat === 'long_image' && results.length > 1) {
          const longImg = await stitchCanvasesVertically(results, { format: imgFormat });
          files.unshift(buildResultFileFromStitched(longImg, `Combined Interfaces (${results.length})`, 'Combined Long Image'));
          triggerCaptureDownload(longImg.dataUrl, longImg.filename);
          showToast(`Stitched & exported ${results.length} captures as Long Image`);
        } else {
          showToast(
            results.length > 1
              ? `Captured "${results[0].name}" + ${results.length - 1} panels`
              : `Captured "${results[0].name}" (${results[0].formattedSize})`
          );
        }

        setCapturedResults(results);
        setGeneratedFiles(files);
        setMultiReport(null);
        setTimeout(() => resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else if (captureScope === 'multiple') {
        if (selectedMultipleIds.length === 0) {
          showToast('Please select at least one interface to capture.');
          setIsCapturing(false);
          return;
        }

        const results: CapturedInterfaceResult[] = [];
        const failures: Array<{ name: string; route: string; error: string }> = [];
        const files: GeneratedResultFile[] = [];
        const total = selectedMultipleIds.length;
        const visitedIds = new Set<string>();

        for (let i = 0; i < total; i++) {
          const id = selectedMultipleIds[i];
          if (visitedIds.has(id)) continue;
          const meta = getInterfaceById(id);
          const name = meta?.name || id;

          setProgress({
            current: i + 1,
            total,
            interfaceName: name,
            percent: Math.round(((i + 1) / total) * 100),
          });

          try {
            const itemResults = await captureInterfaceByIdWithPanels(
              id,
              {
                fullHeight: isFull,
                format: imgFormat,
              },
              visitedIds
            );
            results.push(...itemResults);
            for (const r of itemResults) {
              files.push(buildResultFileFromCapture(r, imgFormat === 'jpeg' ? 'jpg' : 'png'));
            }
          } catch (err: any) {
            failures.push({ name, route: id, error: err?.message || 'Failed to capture' });
            files.push(buildFailureResultFile(name, id, err?.message || 'Failed to capture', meta?.category || 'Interface'));
          }
          await new Promise((r) => setTimeout(r, 40));
        }

        if (exportFormat === 'long_image' && results.length > 0) {
          const longImg = await stitchCanvasesVertically(results, { format: imgFormat });
          files.unshift(buildResultFileFromStitched(longImg, `Combined Interfaces (${results.length})`, 'Combined Long Image'));
          triggerCaptureDownload(longImg.dataUrl, longImg.filename);
          showToast(`Stitched & exported ${results.length} interfaces as Long Image`);
        } else if (exportFormat === 'pdf' && results.length > 0) {
          const pdfDoc = await exportCapturesToPdf(results, 'AXON_Interface_Documentation.pdf');
          files.unshift(buildResultFileFromPdf(pdfDoc, `Interface Documentation (${results.length} Pages)`, 'Documentation PDF', 'all', results.length));
          triggerCaptureDownload(pdfDoc.dataUrl, pdfDoc.filename);
          showToast(`Exported ${results.length} interfaces as PDF document`);
        } else {
          showToast(`Captured ${results.length} interfaces`);
        }

        setCapturedResults(results);
        setGeneratedFiles(files);
        setMultiReport({
          results,
          successfulCount: results.length,
          failedCount: failures.length,
          failures,
          totalDurationMs: 0,
        });
        setTimeout(() => resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      } else if (captureScope === 'all') {
        const report = await captureAllInterfaces({
          fullHeight: isFull,
          format: imgFormat,
          onProgress: (prog) => setProgress(prog),
        });

        const files: GeneratedResultFile[] = [];
        for (const res of report.results) {
          files.push(buildResultFileFromCapture(res, imgFormat === 'jpeg' ? 'jpg' : 'png'));
        }
        for (const fail of report.failures) {
          files.push(buildFailureResultFile(fail.name, fail.route, fail.error));
        }

        if (exportFormat === 'long_image' && report.results.length > 0) {
          const longImg = await stitchCanvasesVertically(report.results, { format: imgFormat });
          files.unshift(buildResultFileFromStitched(longImg, `All AXON Interfaces (${report.results.length})`, 'Combined Long Image'));
          triggerCaptureDownload(longImg.dataUrl, longImg.filename);
          showToast(`Stitched all ${report.results.length} interfaces as Long Image`);
        } else if (exportFormat === 'pdf' && report.results.length > 0) {
          const pdfDoc = await exportCapturesToPdf(report.results, 'AXON_Interface_Documentation.pdf');
          files.unshift(buildResultFileFromPdf(pdfDoc, `AXON Interface Documentation (${report.results.length} Pages)`, 'Documentation PDF', 'all', report.results.length));
          triggerCaptureDownload(pdfDoc.dataUrl, pdfDoc.filename);
          showToast(`Exported all ${report.results.length} interfaces to PDF`);
        } else {
          showToast(`All-interface capture complete (${report.successfulCount} captured)`);
        }

        setCapturedResults(report.results);
        setGeneratedFiles(files);
        setMultiReport(report);
        setTimeout(() => resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      }
    } catch (err: any) {
      console.error('Capture execution failure:', err);
      showToast(err?.message || 'Capture failed');
    } finally {
      setIsCapturing(false);
      setProgress(null);
    }
  };

  const handleExportResultFile = (file: GeneratedResultFile) => {
    if (!file.dataUrl) return;
    triggerCaptureDownload(file.dataUrl, file.fileName);
    showToast(`Downloaded ${file.fileName}`);
  };

  const handleDownloadAllFiles = async () => {
    const downloadable = generatedFiles.filter((f) => f.status === 'success' && f.dataUrl);
    if (downloadable.length === 0) return;
    showToast(`Downloading ${downloadable.length} files...`);
    for (let i = 0; i < downloadable.length; i++) {
      const f = downloadable[i];
      triggerCaptureDownload(f.dataUrl!, f.fileName);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const handleDownloadSingle = (result: CapturedInterfaceResult, formatOverride?: 'png' | 'jpg') => {
    const ext = formatOverride || (result.format === 'jpeg' ? 'jpg' : 'png');
    const filename = getSafeInterfaceFileName(result.name, ext);
    triggerCaptureDownload(result.dataUrl, filename);
    showToast(`Downloaded ${filename}`);
  };

  const handleExportCombinedLongImage = async () => {
    if (capturedResults.length === 0) return;
    try {
      const longImg = await stitchCanvasesVertically(capturedResults);
      triggerCaptureDownload(longImg.dataUrl, longImg.filename);
      showToast('Downloaded Long Image');
    } catch (err: any) {
      showToast(err?.message || 'Failed to stitch images');
    }
  };

  const handleExportCombinedPdf = async () => {
    if (capturedResults.length === 0) return;
    try {
      const pdfDoc = await exportCapturesToPdf(capturedResults);
      triggerCaptureDownload(pdfDoc.dataUrl, pdfDoc.filename);
      showToast('Downloaded PDF document');
    } catch (err: any) {
      showToast(err?.message || 'Failed to generate PDF');
    }
  };

  const handleShareResult = async (result: CapturedInterfaceResult) => {
    if (navigator.share && typeof navigator.share === 'function') {
      try {
        const response = await fetch(result.dataUrl);
        const blob = await response.blob();
        const file = new File([blob], getSafeInterfaceFileName(result.name, 'png'), { type: 'image/png' });
        await navigator.share({
          title: `AXON Interface Capture - ${result.name}`,
          files: [file],
        });
        showToast('Shared interface image');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(result.dataUrl);
      setCopiedId(result.id);
      showToast('Image DataURL copied to clipboard');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showToast('Unable to share or copy image');
    }
  };

  const filteredInterfaces = availableInterfaces.filter((i) => {
    const q = searchFilter.toLowerCase().trim();
    if (!q) return true;
    return (
      i.name.toLowerCase().includes(q) ||
      i.category.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.keywords.some((k) => k.includes(q))
    );
  });

  return (
    <div
      id="interface-capture-screen"
      className="flex-1 min-h-0 overflow-y-auto p-4 bg-black text-white select-none"
    >
      <div className="max-w-md mx-auto space-y-4 pb-12">
        {/* Header Title Section */}
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white text-black flex items-center justify-center font-bold">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Interface Capture</h2>
              <p className="text-xs text-neutral-400 mt-0.5">
                Pixel-accurate visual capture & documentation engine
              </p>
            </div>
          </div>
        </div>

        {/* 1. Capture Scope Selection */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-neutral-900/90 border border-neutral-800">
          <label className="text-xs font-semibold text-neutral-300 block">Capture Scope</label>
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-neutral-950 border border-neutral-800">
            {[
              { id: 'current', label: 'Current' },
              { id: 'specific', label: 'Specific' },
              { id: 'multiple', label: 'Multiple' },
              { id: 'all', label: 'All UI' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCaptureScope(tab.id as any)}
                className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-all text-center truncate ${
                  captureScope === tab.id
                    ? 'bg-white text-black font-semibold shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Scope details / Target pickers */}
          {captureScope === 'current' && (
            <div className="mt-2 p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 text-xs text-neutral-300 flex items-center justify-between">
              <div className="truncate">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider block font-mono">Target View</span>
                <span className="font-semibold text-white truncate">{currentMeta.name}</span>
                <span className="text-[11px] text-neutral-400 ml-1.5">({currentMeta.category})</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-neutral-800 text-[10px] text-neutral-300 font-mono">
                Live DOM
              </span>
            </div>
          )}

          {captureScope === 'specific' && (
            <div className="mt-2 space-y-1.5">
              <label className="text-[11px] text-neutral-400">Select Interface to Render & Capture:</label>
              <select
                value={selectedInterfaceId}
                onChange={(e) => setSelectedInterfaceId(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-neutral-600"
              >
                {availableInterfaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.category}] {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {captureScope === 'multiple' && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">
                  {selectedMultipleIds.length} of {availableInterfaces.length} interfaces selected
                </span>
                <button
                  type="button"
                  onClick={handleSelectAllMultiple}
                  className="text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                >
                  {selectedMultipleIds.length === availableInterfaces.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="max-h-44 overflow-y-auto space-y-1 p-1.5 rounded-xl bg-neutral-950 border border-neutral-800">
                {availableInterfaces.map((item) => {
                  const isChecked = selectedMultipleIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleToggleMultipleId(item.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-neutral-900 cursor-pointer text-xs"
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-white shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-neutral-600 shrink-0" />
                      )}
                      <span className={isChecked ? 'text-white font-medium' : 'text-neutral-400'}>
                        {item.name}
                      </span>
                      <span className="text-[10px] text-neutral-500 ml-auto font-mono">
                        {item.category}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {captureScope === 'all' && (
            <div className="mt-2 p-2.5 rounded-xl bg-neutral-950/70 border border-neutral-800/80 text-xs text-neutral-300">
              <div className="flex items-center justify-between font-semibold text-white">
                <span>Capture All {availableInterfaces.length} Interfaces</span>
                <span className="text-[10px] font-mono text-neutral-400">Full System Pass</span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                Iterates through every real screen in AXON's navigation hierarchy, captures each rendered DOM view, and packages individual images, long stitch, or multi-page PDF.
              </p>
            </div>
          )}
        </div>

        {/* 2. Capture Type & Output Format */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Capture Type */}
          <div className="p-3 rounded-2xl bg-neutral-900/90 border border-neutral-800 space-y-2">
            <label className="text-xs font-semibold text-neutral-300 block">Capture Mode</label>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-neutral-950 border border-neutral-800">
              <button
                type="button"
                onClick={() => setCaptureType('visible')}
                className={`py-1 px-1 rounded-lg text-[11px] font-medium transition-all text-center truncate ${
                  captureType === 'visible'
                    ? 'bg-white text-black font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Visible
              </button>
              <button
                type="button"
                onClick={() => setCaptureType('full')}
                className={`py-1 px-1 rounded-lg text-[11px] font-medium transition-all text-center truncate ${
                  captureType === 'full'
                    ? 'bg-white text-black font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Full Page
              </button>
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight">
              {captureType === 'full' ? 'Full interface + independent panel breakdown & full scroll' : 'Captures exact viewport dimensions'}
            </p>
          </div>

          {/* Export Output */}
          <div className="p-3 rounded-2xl bg-neutral-900/90 border border-neutral-800 space-y-2">
            <label className="text-xs font-semibold text-neutral-300 block">Export Format</label>
            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-xl bg-neutral-950 border border-neutral-800">
              {[
                { id: 'png', label: 'PNG' },
                { id: 'jpeg', label: 'JPG' },
                { id: 'long_image', label: 'Long Img' },
                { id: 'pdf', label: 'PDF' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setExportFormat(f.id as any)}
                  className={`py-1 px-1 rounded-lg text-[10px] font-medium transition-all text-center truncate ${
                    exportFormat === f.id
                      ? 'bg-white text-black font-semibold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-neutral-400 leading-tight truncate">
              {exportFormat === 'pdf' ? 'Multi-page document' : exportFormat === 'long_image' ? 'Vertical stitched image' : 'Individual images'}
            </p>
          </div>
        </div>

        {/* 3. Primary Action Button */}
        <div>
          <button
            id="start-interface-capture-btn"
            type="button"
            disabled={isCapturing}
            onClick={handleExecuteCapture}
            className="w-full py-3 px-4 rounded-2xl bg-white text-black hover:bg-neutral-200 active:scale-[0.99] font-bold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isCapturing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-black" />
                <span>Capturing AXON Interface...</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4 text-black" />
                <span>
                  Capture {captureScope === 'all' ? 'All Interfaces' : captureScope === 'multiple' ? `${selectedMultipleIds.length} Selected` : 'Interface'}
                </span>
              </>
            )}
          </button>
        </div>

        {/* 4. Active Progress Bar (Requirement 15) */}
        {progress && (
          <div className="p-3.5 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400">Capturing AXON interfaces...</span>
              <span className="font-mono text-white font-bold">
                {progress.current} / {progress.total}
              </span>
            </div>
            <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-150 rounded-full"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-neutral-300 truncate">
                Current: <strong className="text-white">{progress.interfaceName}</strong>
              </span>
              <span className="text-neutral-500 font-mono">{progress.percent}%</span>
            </div>
          </div>
        )}

        {/* 5. Failure / Completion Report Callout (Requirement 15) */}
        {multiReport && (
          <div className="p-3 rounded-2xl bg-neutral-900/80 border border-neutral-800 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-400" />
                Capture Run Completed
              </span>
              <span className="text-[11px] text-neutral-400 font-mono">
                {multiReport.successfulCount} captured
              </span>
            </div>
            {multiReport.failedCount > 0 && (
              <div className="text-[11px] text-amber-400 pt-1 border-t border-neutral-800">
                <p className="font-medium">
                  {multiReport.failedCount} interface{multiReport.failedCount > 1 ? 's' : ''} could not be captured:
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-neutral-400 mt-1">
                  {multiReport.failures.map((f, i) => (
                    <li key={i}>
                      <strong className="text-neutral-300">{f.name}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 6. Generated Result Files (Comprehensive Results Presentation) */}
        {generatedFiles.length > 0 && (
          <div ref={resultsSectionRef} className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Generated Result Files ({generatedFiles.length})</span>
                </h3>
                <p className="text-[11px] text-neutral-400">
                  All capture outputs ready for immediate inspection and export
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {generatedFiles.filter((f) => f.status === 'success' && f.dataUrl).length > 1 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllFiles}
                    className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-[11px] text-white font-medium flex items-center gap-1"
                  >
                    <FolderDown className="w-3 h-3 text-neutral-300" />
                    <span>Download All</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setGeneratedFiles([]);
                    setCapturedResults([]);
                    setMultiReport(null);
                  }}
                  className="p-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-white text-[11px]"
                  title="Clear Results"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Individual Result File Cards */}
            <div className="space-y-2">
              {generatedFiles.map((file) => (
                <div
                  key={file.id}
                  className={`p-3 rounded-2xl border transition-all ${
                    file.status === 'success'
                      ? 'bg-neutral-900/90 border-neutral-800 hover:border-neutral-700'
                      : 'bg-rose-950/20 border-rose-900/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {/* Format icon or mini thumbnail */}
                      {file.dataUrl && file.fileFormat !== 'PDF' ? (
                        <div
                          onClick={() => setActivePreviewFile(file)}
                          className="w-12 h-16 rounded-lg bg-black border border-neutral-800 overflow-hidden shrink-0 cursor-pointer relative group"
                        >
                          <img
                            src={file.dataUrl}
                            alt={file.interfaceName}
                            className="w-full h-full object-cover object-top"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-3.5 h-3.5 text-white" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-12 h-16 rounded-lg bg-neutral-800/80 border border-neutral-700 flex flex-col items-center justify-center shrink-0">
                          {file.fileFormat === 'PDF' ? (
                            <FileText className="w-5 h-5 text-rose-400" />
                          ) : file.status === 'failed' ? (
                            <AlertCircle className="w-5 h-5 text-rose-400" />
                          ) : (
                            <FileImage className="w-5 h-5 text-blue-400" />
                          )}
                          <span className="text-[9px] font-mono font-bold mt-1 text-neutral-300">
                            {file.fileFormat}
                          </span>
                        </div>
                      )}

                      {/* Interface & File Metadata */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-white truncate">
                            {file.interfaceName}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 font-mono">
                            {file.category}
                          </span>
                          {file.status === 'success' ? (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              <span>Capture Succeeded</span>
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                              <AlertCircle className="w-2.5 h-2.5" />
                              <span>Capture Failed</span>
                            </span>
                          )}
                        </div>

                        <div className="font-mono text-[11px] text-neutral-300 flex items-center gap-1.5">
                          <span className="text-white font-medium truncate">{file.fileName}</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                            {file.fileType}
                          </span>
                        </div>

                        <div className="text-[10px] text-neutral-400 font-mono flex items-center gap-2">
                          {file.dimensions && <span>{file.dimensions}</span>}
                          <span>•</span>
                          <span>{file.fileSize}</span>
                          <span>•</span>
                          <span>{file.capturedAt}</span>
                        </div>

                        {file.errorMessage && (
                          <p className="text-[11px] text-rose-400 font-mono pt-0.5">
                            {file.errorMessage}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Individual Action Buttons */}
                    {file.status === 'success' && file.dataUrl && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setActivePreviewFile(file)}
                          className="py-1 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-[11px] font-medium text-white flex items-center justify-center gap-1.5"
                        >
                          <Eye className="w-3 h-3 text-neutral-300" />
                          <span>View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportResultFile(file)}
                          className="py-1 px-2.5 rounded-lg bg-white hover:bg-neutral-200 text-black active:scale-95 text-[11px] font-bold flex items-center justify-center gap-1.5"
                        >
                          <Download className="w-3 h-3 text-black" />
                          <span>Save</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. Captured Results Gallery & Batch Actions */}
        {capturedResults.length > 0 && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Captured Outputs ({capturedResults.length})
              </h3>
              <div className="flex items-center gap-1.5">
                {capturedResults.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={handleExportCombinedLongImage}
                      className="px-2 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] text-neutral-200 hover:text-white flex items-center gap-1"
                    >
                      <Layers className="w-3 h-3" />
                      <span>Long Image</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportCombinedPdf}
                      className="px-2 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[11px] text-neutral-200 hover:text-white flex items-center gap-1"
                    >
                      <FileText className="w-3 h-3" />
                      <span>PDF</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {capturedResults.map((res) => (
                <div
                  key={res.id}
                  className="rounded-2xl bg-neutral-900/90 border border-neutral-800 overflow-hidden flex flex-col group hover:border-neutral-700 transition-all"
                >
                  {/* Thumbnail */}
                  <div
                    onClick={() => setPreviewResult(res)}
                    className="relative aspect-9/16 bg-neutral-950 cursor-pointer overflow-hidden flex items-center justify-center"
                  >
                    <img
                      src={res.dataUrl}
                      alt={res.name}
                      className="w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <span className="p-1.5 rounded-lg bg-white/20 backdrop-blur-md text-white">
                        <Maximize2 className="w-4 h-4" />
                      </span>
                    </div>
                  </div>

                  {/* Card Info & Actions */}
                  <div className="p-2.5 space-y-1.5 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white truncate">{res.name}</h4>
                      <p className="text-[10px] text-neutral-400 font-mono flex items-center justify-between mt-0.5">
                        <span>{res.width}x{res.height}px</span>
                        <span>{res.formattedSize}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-1 pt-1 border-t border-neutral-800/80">
                      <button
                        type="button"
                        onClick={() => handleDownloadSingle(res)}
                        className="py-1 px-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-[10px] font-medium text-white flex items-center justify-center gap-1"
                        title="Download PNG"
                      >
                        <Download className="w-3 h-3" />
                        <span>PNG</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleShareResult(res)}
                        className="py-1 px-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-[10px] font-medium text-neutral-300 hover:text-white flex items-center justify-center gap-1"
                        title="Share / Copy DataURL"
                      >
                        {copiedId === res.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Share2 className="w-3 h-3" />
                        )}
                        <span>Share</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. Registered AXON Interfaces Directory */}
        <div className="space-y-2.5 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Registered Interfaces ({availableInterfaces.length})
            </h3>
            <span className="text-[10px] text-neutral-500 font-mono">100% Real DOM</span>
          </div>

          {/* Search Filter */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search interfaces..."
              className="w-full bg-neutral-900 border border-neutral-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-700"
            />
          </div>

          {/* Interfaces List */}
          <div className="space-y-1.5">
            {filteredInterfaces.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 hover:bg-neutral-900 transition-all flex items-center justify-between gap-2"
              >
                <div className="truncate flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-white truncate">{item.name}</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-neutral-800 text-neutral-400 font-mono">
                      {item.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 truncate mt-0.5">{item.description}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setIsCapturing(true);
                      const itemResults = await captureInterfaceByIdWithPanels(item.id, { fullHeight: captureType === 'full' });
                      setCapturedResults((prev) => [...itemResults, ...prev]);
                      const newFiles = itemResults.map((r) => buildResultFileFromCapture(r));
                      setGeneratedFiles((prev) => [...newFiles, ...prev]);
                      showToast(
                        itemResults.length > 1
                          ? `Captured "${item.name}" + ${itemResults.length - 1} panels`
                          : `Captured "${item.name}"`
                      );
                      setTimeout(() => resultsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                    } catch (err: any) {
                      const failFile = buildFailureResultFile(item.name, item.id, err?.message || 'Capture failed', item.category);
                      setGeneratedFiles((prev) => [failFile, ...prev]);
                      showToast(err?.message || 'Capture failed');
                    } finally {
                      setIsCapturing(false);
                    }
                  }}
                  disabled={isCapturing}
                  className="px-2.5 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 active:scale-95 text-[11px] font-medium shrink-0 flex items-center gap-1"
                >
                  <Camera className="w-3 h-3" />
                  <span>Capture</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fullscreen Preview Modal for Active Generated Result File */}
      {activePreviewFile && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md p-4 flex flex-col items-center justify-center"
          onClick={() => setActivePreviewFile(null)}
        >
          <div
            className="max-w-xl w-full max-h-[90vh] bg-neutral-950 border border-neutral-800 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Bar */}
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between shrink-0">
              <div className="min-w-0 flex-1 mr-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-white truncate">
                    {activePreviewFile.interfaceName}
                  </h3>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
                    {activePreviewFile.fileFormat}
                  </span>
                  {activePreviewFile.status === 'success' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Capture Succeeded
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate">
                  {activePreviewFile.fileName} • {activePreviewFile.dimensions} • {activePreviewFile.fileSize}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {activePreviewFile.dataUrl && (
                  <button
                    type="button"
                    onClick={() => handleExportResultFile(activePreviewFile)}
                    className="px-3 py-1 rounded-lg bg-white text-black font-bold text-xs flex items-center gap-1.5 active:scale-95 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Save / Export</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActivePreviewFile(null)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Preview Container */}
            <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center bg-black">
              {activePreviewFile.fileFormat === 'PDF' && activePreviewFile.dataUrl ? (
                <iframe
                  src={activePreviewFile.dataUrl}
                  title={activePreviewFile.fileName}
                  className="w-full h-full min-h-[500px] rounded-xl border border-neutral-800 bg-white"
                />
              ) : activePreviewFile.dataUrl ? (
                <img
                  src={activePreviewFile.dataUrl}
                  alt={activePreviewFile.interfaceName}
                  className="max-w-full max-h-full object-contain rounded-xl shadow-lg border border-neutral-800"
                />
              ) : (
                <div className="text-center p-8 text-neutral-400">
                  <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
                  <p className="text-xs">{activePreviewFile.errorMessage || 'Preview unavailable'}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Zoom Modal for Preview Thumbnail (Requirement 13) */}
      {previewResult && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md p-4 flex flex-col items-center justify-center"
          onClick={() => setPreviewResult(null)}
        >
          <div
            className="max-w-xl w-full max-h-[90vh] bg-neutral-950 border border-neutral-800 rounded-3xl overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Bar */}
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white">{previewResult.name}</h3>
                <p className="text-[10px] text-neutral-400 font-mono">
                  {previewResult.width}x{previewResult.height}px • {previewResult.formattedSize}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadSingle(previewResult, 'png')}
                  className="px-2.5 py-1 rounded-lg bg-white text-black font-semibold text-xs flex items-center gap-1"
                >
                  <Download className="w-3 h-3" />
                  <span>PNG</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewResult(null)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white text-xs"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Image Preview Container */}
            <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center bg-black">
              <img
                src={previewResult.dataUrl}
                alt={previewResult.name}
                className="max-w-full max-h-full object-contain rounded-xl shadow-lg border border-neutral-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
