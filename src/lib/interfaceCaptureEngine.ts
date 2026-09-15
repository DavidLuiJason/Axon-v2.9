import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { ScreenId } from '../types';
import {
  AXON_INTERFACES,
  InterfaceMetadata,
  getInterfaceById,
  getSafeInterfaceFileName,
  discoverAvailableInterfaces,
} from './interfaceRegistry';
import { sanitizeClonedTreeForCapture, wrapWindowGetComputedStyle } from './colorConverter';

export interface GeneratedResultFile {
  id: string;
  interfaceName: string;
  category: string;
  route: string;
  status: 'success' | 'failed';
  errorMessage?: string;
  fileName: string;
  fileFormat: 'PNG' | 'JPG' | 'PDF';
  fileType: string;
  fileSize: string;
  dimensions?: string;
  dataUrl?: string;
  capturedAt: string;
}

export interface CapturedInterfaceResult {
  id: string;
  name: string;
  category: string;
  route: ScreenId | string;
  canvas: HTMLCanvasElement;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  formattedSize: string;
  capturedAt: string;
  format: 'png' | 'jpeg';
  isSuccess: boolean;
  error?: string;
  panelResults?: CapturedInterfaceResult[];
}

export interface CaptureEngineOptions {
  scale?: number;
  fullHeight?: boolean;
  format?: 'png' | 'jpeg';
  quality?: number;
  includePanels?: boolean;
  recursive?: boolean;
  onProgress?: (progress: { current: number; total: number; interfaceName: string; percent: number }) => void;
}

export interface MultiCaptureReport {
  results: CapturedInterfaceResult[];
  successfulCount: number;
  failedCount: number;
  failures: Array<{ name: string; route: string; error: string }>;
  totalDurationMs: number;
  combinedLongImage?: {
    canvas: HTMLCanvasElement;
    dataUrl: string;
    width: number;
    height: number;
    filename: string;
  };
  pdfDocument?: {
    blob: Blob;
    dataUrl: string;
    filename: string;
  };
}

// Stage controller types for offscreen rendering
export interface StageHandle {
  element: HTMLElement;
  release: () => void;
}

export type StageRenderRequester = (
  route: ScreenId | string,
  isFull: boolean,
  interfaceId?: string
) => Promise<HTMLElement | StageHandle | null>;

let globalStageRequester: StageRenderRequester | null = null;

export function registerOffscreenStageRequester(requester: StageRenderRequester | null): void {
  globalStageRequester = requester;
}

/**
 * Ensures the offscreen stage requester is available and mounted before background staging.
 */
export async function waitForStageRequester(timeoutMs = 1500): Promise<StageRenderRequester | null> {
  if (globalStageRequester) return globalStageRequester;
  const start = Date.now();
  while (!globalStageRequester && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 40));
  }
  return globalStageRequester;
}

/**
 * Formats byte size into human readable string.
 */
function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Captures an HTMLElement using html2canvas with retina scaling and crisp typography rendering.
 */
export async function captureDomElement(
  element: HTMLElement,
  options: {
    scale?: number;
    fullHeight?: boolean;
    format?: 'png' | 'jpeg';
    quality?: number;
    windowWidth?: number;
  } = {}
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  const isFull = options.fullHeight ?? false;

  // If full interface is requested, locate scrollable child and expand height temporarily
  let restoreStyles: (() => void) | null = null;
  if (isFull) {
    const scrollContainer =
      (element.querySelector('.overflow-y-auto, [id$="-screen"]') as HTMLElement) ||
      (element.scrollHeight > element.clientHeight ? element : null);

    if (scrollContainer) {
      const prevOverflow = scrollContainer.style.overflow;
      const prevHeight = scrollContainer.style.height;
      const prevMaxHeight = scrollContainer.style.maxHeight;

      scrollContainer.style.overflow = 'visible';
      scrollContainer.style.height = 'auto';
      scrollContainer.style.maxHeight = 'none';

      restoreStyles = () => {
        scrollContainer.style.overflow = prevOverflow;
        scrollContainer.style.height = prevHeight;
        scrollContainer.style.maxHeight = prevMaxHeight;
      };
    }
  }

  try {
    // Wait one animation frame for reflow to settle
    await new Promise((resolve) => requestAnimationFrame(resolve));

    let unwrapGlobal: (() => void) | null = null;
    let unwrapCloned: (() => void) | null = null;
    if (typeof window !== 'undefined') {
      unwrapGlobal = wrapWindowGetComputedStyle(window);
    }

    try {
      const canvas = await html2canvas(element, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#000000',
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: options.windowWidth || element.scrollWidth || 430,
        windowHeight: isFull ? Math.max(element.scrollHeight, 800) : element.clientHeight || 932,
        ignoreElements: (el) => {
          // Never let html2canvas clone execution sandboxes or iframe internals
          return el.tagName === 'IFRAME';
        },
        onclone: (clonedDoc, clonedElement) => {
          // Normalize position of offscreen capture stage in clone so it renders cleanly at 0,0
          const stageInClone =
            clonedDoc.getElementById('axon-offscreen-capture-stage') ||
            (clonedElement?.closest?.('#axon-offscreen-capture-stage') as HTMLElement | null) ||
            (clonedElement?.id === 'axon-offscreen-capture-stage' ? clonedElement : null);

          if (stageInClone) {
            stageInClone.style.position = 'relative';
            stageInClone.style.left = '0px';
            stageInClone.style.top = '0px';
            stageInClone.style.zIndex = '1';
            stageInClone.style.transform = 'none';
          }

          if (clonedElement && clonedElement.id === 'axon-offscreen-capture-stage') {
            clonedElement.style.position = 'relative';
            clonedElement.style.left = '0px';
            clonedElement.style.top = '0px';
            clonedElement.style.zIndex = '1';
            clonedElement.style.transform = 'none';
          }

          if (clonedDoc.defaultView && clonedDoc.defaultView !== window) {
            unwrapCloned = wrapWindowGetComputedStyle(clonedDoc.defaultView);
          }
          sanitizeClonedTreeForCapture(clonedDoc, clonedElement, element);
        },
      });

      return canvas;
    } finally {
      if (unwrapCloned) {
        unwrapCloned();
      }
      if (unwrapGlobal) {
        unwrapGlobal();
      }
    }
  } finally {
    if (restoreStyles) {
      restoreStyles();
    }
  }
}

export interface DetectedPanel {
  element: HTMLElement;
  id: string;
  name: string;
  index: number;
  isScrollable: boolean;
  scrollElement: HTMLElement | null;
}

export interface MultiPanelDetection {
  hasMultiplePanels: boolean;
  trackElement: HTMLElement | null;
  containerElement: HTMLElement | null;
  panels: DetectedPanel[];
}

/**
 * Checks if an element is an independently scrollable container using DOM inspection.
 */
export function isScrollableElement(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth) {
    return false;
  }
  if (el.clientHeight < 60 || el.clientWidth < 60) {
    return false;
  }
  const style = window.getComputedStyle(el);
  return (
    style.overflowY === 'auto' ||
    style.overflowY === 'scroll' ||
    style.overflowX === 'auto' ||
    style.overflowX === 'scroll' ||
    style.overflow === 'auto' ||
    style.overflow === 'scroll'
  );
}

/**
 * Finds the primary scrollable container within a given panel element.
 */
export function findScrollContainer(element: HTMLElement): HTMLElement | null {
  if (isScrollableElement(element)) {
    return element;
  }
  const scrollables = Array.from(element.querySelectorAll<HTMLElement>('*')).filter(isScrollableElement);
  if (scrollables.length === 0) {
    const byClass = element.querySelector<HTMLElement>('.overflow-y-auto, .overflow-auto');
    if (byClass && byClass.scrollHeight > byClass.clientHeight) return byClass;
    return null;
  }
  scrollables.sort((a, b) => b.scrollHeight * b.clientWidth - a.scrollHeight * a.clientWidth);
  return scrollables[0];
}

/**
 * Inspects the actual DOM to detect side-by-side panels, dual-pane layouts,
 * split views, or independently scrollable panels.
 */
export function detectInterfacePanels(rootElement: HTMLElement, baseName: string): MultiPanelDetection {
  // 1. Direct check: AXON DualPaneContainer or explicit dual-pane structures
  const track = (rootElement.id === 'dual-pane-track'
    ? rootElement
    : rootElement.querySelector('#dual-pane-track')) as HTMLElement | null;

  if (track) {
    const container =
      (rootElement.id === 'dual-pane-container'
        ? rootElement
        : rootElement.querySelector('#dual-pane-container') || track.parentElement) as HTMLElement | null;

    const left = (track.querySelector('#dual-pane-left') || track.children[0]) as HTMLElement | null;
    const right = (track.querySelector('#dual-pane-right') || track.children[1]) as HTMLElement | null;

    if (left && right) {
      const panels: DetectedPanel[] = [
        {
          element: left,
          id: 'dual-pane-left',
          name: `${baseName} — Left Panel`,
          index: 0,
          isScrollable: true,
          scrollElement: findScrollContainer(left),
        },
        {
          element: right,
          id: 'dual-pane-right',
          name: `${baseName} — Right Panel`,
          index: 1,
          isScrollable: true,
          scrollElement: findScrollContainer(right),
        },
      ];

      return {
        hasMultiplePanels: true,
        trackElement: track,
        containerElement: container,
        panels,
      };
    }
  }

  // 2. Check for flex-row or grid containers with side-by-side children
  const potentialTracks = Array.from(
    rootElement.querySelectorAll<HTMLElement>('*')
  ).filter((el) => {
    if (el.clientWidth < 160 || el.clientHeight < 100) return false;
    const style = window.getComputedStyle(el);
    const isRow =
      (style.display.includes('flex') && style.flexDirection === 'row') ||
      style.display.includes('grid');
    return isRow && el.children.length >= 2;
  });

  for (const pTrack of potentialTracks) {
    const substantiveChildren = Array.from(pTrack.children).filter(
      (c): c is HTMLElement =>
        c instanceof HTMLElement && c.offsetWidth >= 80 && c.offsetHeight >= 80
    );

    if (substantiveChildren.length >= 2) {
      const rect0 = substantiveChildren[0].getBoundingClientRect();
      const rect1 = substantiveChildren[1].getBoundingClientRect();
      const isSideBySide =
        rect0.left < rect1.left || substantiveChildren[0].offsetLeft < substantiveChildren[1].offsetLeft;

      if (isSideBySide) {
        const panels: DetectedPanel[] = substantiveChildren.map((child, idx) => {
          const headerText = child
            .querySelector('h1, h2, h3, h4, header, [role="heading"]')
            ?.textContent?.trim()
            ?.slice(0, 24);

          let panelLabel = `${baseName} — Panel ${idx + 1}`;
          if (substantiveChildren.length === 2) {
            panelLabel = idx === 0 ? `${baseName} — Left Panel` : `${baseName} — Right Panel`;
          }
          if (headerText) {
            panelLabel += ` (${headerText})`;
          }

          const scrollEl = findScrollContainer(child);
          return {
            element: child,
            id: child.id || `panel-${idx}`,
            name: panelLabel,
            index: idx,
            isScrollable: !!scrollEl,
            scrollElement: scrollEl,
          };
        });

        return {
          hasMultiplePanels: true,
          trackElement: pTrack,
          containerElement: pTrack.parentElement,
          panels,
        };
      }
    }
  }

  // 3. Check for multiple top-level independently scrollable containers
  const allScrollables = Array.from(
    rootElement.querySelectorAll<HTMLElement>('*')
  ).filter((el) => isScrollableElement(el) && el.offsetWidth >= 100 && el.offsetHeight >= 100);

  const topScrollables = allScrollables.filter(
    (el) => !allScrollables.some((other) => other !== el && other.contains(el))
  );

  if (topScrollables.length >= 2) {
    topScrollables.sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );

    const panels: DetectedPanel[] = topScrollables.map((el, idx) => {
      let panelLabel = `${baseName} — Panel ${idx + 1}`;
      if (topScrollables.length === 2) {
        panelLabel = idx === 0 ? `${baseName} — Left Panel` : `${baseName} — Right Panel`;
      }
      return {
        element: el,
        id: el.id || `scroll-panel-${idx}`,
        name: panelLabel,
        index: idx,
        isScrollable: true,
        scrollElement: el,
      };
    });

    return {
      hasMultiplePanels: true,
      trackElement: null,
      containerElement: null,
      panels,
    };
  }

  return {
    hasMultiplePanels: false,
    trackElement: null,
    containerElement: null,
    panels: [],
  };
}

/**
 * Stitches captured scroll slices of an individual panel together into a seamless composite.
 */
function stitchPanelSlices(
  slices: HTMLCanvasElement[],
  scrollEl: HTMLElement,
  panelEl: HTMLElement,
  positions: number[],
  scale: number
): HTMLCanvasElement {
  if (slices.length === 0) {
    return document.createElement('canvas');
  }
  if (slices.length === 1) {
    return slices[0];
  }

  const panelRect = panelEl.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();

  const topOffsetPx = Math.max(0, Math.round((scrollRect.top - panelRect.top) * scale));
  const bottomOffsetPx = Math.max(0, Math.round((panelRect.bottom - scrollRect.bottom) * scale));
  const totalScrollPx = Math.round(scrollEl.scrollHeight * scale);

  const canvasWidth = slices[0].width;
  const totalCanvasHeight = Math.max(
    topOffsetPx + totalScrollPx + bottomOffsetPx,
    slices[0].height
  );

  const master = document.createElement('canvas');
  master.width = canvasWidth;
  master.height = totalCanvasHeight;
  const ctx = master.getContext('2d');
  if (!ctx) return slices[0];

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, master.width, master.height);

  // 1. Draw top fixed header from slice 0
  if (topOffsetPx > 0) {
    ctx.drawImage(
      slices[0],
      0, 0, canvasWidth, topOffsetPx,
      0, 0, canvasWidth, topOffsetPx
    );
  }

  // 2. Draw scroll body slices
  for (let k = 0; k < positions.length; k++) {
    const currentScroll = positions[k];
    const nextScroll = k + 1 < positions.length ? positions[k + 1] : scrollEl.scrollHeight - scrollEl.clientHeight;
    const sliceCanvas = slices[k];

    const destY = topOffsetPx + Math.round(currentScroll * scale);
    const sliceHeight = k + 1 < positions.length
      ? Math.round((nextScroll - currentScroll) * scale)
      : Math.round((scrollEl.scrollHeight - currentScroll) * scale);

    const srcY = topOffsetPx;
    ctx.drawImage(
      sliceCanvas,
      0, srcY, canvasWidth, sliceHeight,
      0, destY, canvasWidth, sliceHeight
    );
  }

  // 3. Draw bottom fixed footer from last slice
  if (bottomOffsetPx > 0) {
    const lastSlice = slices[slices.length - 1];
    const srcFooterY = lastSlice.height - bottomOffsetPx;
    const destFooterY = master.height - bottomOffsetPx;
    ctx.drawImage(
      lastSlice,
      0, srcFooterY, canvasWidth, bottomOffsetPx,
      0, destFooterY, canvasWidth, bottomOffsetPx
    );
  }

  return master;
}

/**
 * Captures an individual panel across its different scroll positions independently.
 * Scrolls ONLY this panel while preserving all other panels stationary.
 * Restores the panel to its original scroll position after capture.
 */
async function capturePanelWithIndependentScrolling(
  panel: DetectedPanel,
  allPanels: DetectedPanel[],
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    fullHeight?: boolean;
  }
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  const scrollEl = panel.scrollElement;

  // Snapshot initial scroll state for ALL panels to ensure total isolation
  const initialScrolls = new Map<HTMLElement, { top: number; left: number }>();
  for (const p of allPanels) {
    if (p.scrollElement) {
      initialScrolls.set(p.scrollElement, {
        top: p.scrollElement.scrollTop,
        left: p.scrollElement.scrollLeft,
      });
    }
  }

  try {
    // If no scroll container or not enough scrollable content, capture single state
    if (!scrollEl || scrollEl.scrollHeight <= scrollEl.clientHeight + 15) {
      return await captureDomElement(panel.element, {
        scale,
        fullHeight: options.fullHeight ?? false,
        format: options.format,
        quality: options.quality,
      });
    }

    // Multiple scroll positions exist: calculate scroll positions
    const clientH = scrollEl.clientHeight;
    const scrollH = scrollEl.scrollHeight;
    const maxScroll = scrollH - clientH;
    const step = Math.max(120, clientH - 40);

    const positions: number[] = [];
    for (let y = 0; y < maxScroll; y += step) {
      positions.push(y);
    }
    if (positions[positions.length - 1] !== maxScroll) {
      positions.push(maxScroll);
    }

    if (positions.length <= 1) {
      return await captureDomElement(panel.element, {
        scale,
        fullHeight: options.fullHeight ?? false,
        format: options.format,
        quality: options.quality,
      });
    }

    // Iterate through positions, scrolling ONLY this panel
    const positionCanvases: HTMLCanvasElement[] = [];

    for (let i = 0; i < positions.length; i++) {
      const targetY = positions[i];

      // Scroll ONLY this panel's scroll element
      scrollEl.scrollTop = targetY;

      // Lock and verify other panels remain stationary at their initial positions
      for (const other of allPanels) {
        if (other !== panel && other.scrollElement) {
          const init = initialScrolls.get(other.scrollElement);
          if (init && other.scrollElement.scrollTop !== init.top) {
            other.scrollElement.scrollTop = init.top;
          }
        }
      }

      // Allow 1 frame for browser repaint of scrolled content
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 35)));

      // Capture panel at this scroll position
      const sliceCanvas = await captureDomElement(panel.element, {
        scale,
        fullHeight: false,
        format: options.format,
        quality: options.quality,
      });
      positionCanvases.push(sliceCanvas);
    }

    // Stitch the position canvases together
    return stitchPanelSlices(positionCanvases, scrollEl, panel.element, positions, scale);
  } finally {
    // ALWAYS restore all panels to their exact original scroll positions
    for (const [el, pos] of initialScrolls.entries()) {
      el.scrollTop = pos.top;
      el.scrollLeft = pos.left;
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/**
 * Captures the complete side-by-side interface with both panels visible together.
 * Preserves the panels side-by-side without vertical stacking or UI modification.
 * Fully restores all styles after capture.
 */
async function captureCompleteSideBySideInterface(
  targetElement: HTMLElement,
  detection: MultiPanelDetection,
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    fullHeight?: boolean;
  }
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  const track = detection.trackElement;
  const container = detection.containerElement || track?.parentElement;
  const stage = document.getElementById('axon-offscreen-capture-stage');

  let restoreSideBySide: (() => void) | null = null;

  if (track && detection.panels.length >= 2) {
    const leftWidth = detection.panels[0].element.offsetWidth || 430;
    const rightWidth = detection.panels[1].element.offsetWidth || 430;
    const totalSideBySideWidth = leftWidth + rightWidth;

    const prevTrackTransform = track.style.transform;
    const prevTrackTransition = track.style.transition;
    const prevTrackWidth = track.style.width;
    const prevContainerWidth = container ? container.style.width : '';
    const prevContainerOverflow = container ? container.style.overflow : '';
    const prevStageWidth = stage ? stage.style.width : '';

    track.style.transition = 'none';
    track.style.transform = 'translate3d(0, 0, 0)';

    if (container) {
      container.style.overflow = 'visible';
      container.style.width = `${totalSideBySideWidth}px`;
    }
    if (stage) {
      stage.style.width = `${totalSideBySideWidth}px`;
    }

    restoreSideBySide = () => {
      track.style.transform = prevTrackTransform;
      track.style.transition = prevTrackTransition;
      track.style.width = prevTrackWidth;
      if (container) {
        container.style.width = prevContainerWidth;
        container.style.overflow = prevContainerOverflow;
      }
      if (stage) {
        stage.style.width = prevStageWidth;
      }
    };
  }

  try {
    await new Promise((r) => requestAnimationFrame(r));
    return await captureDomElement(targetElement, {
      scale,
      fullHeight: false, // Preserves side-by-side layout intact
      format: options.format,
      quality: options.quality,
      windowWidth: track && detection.panels.length >= 2
        ? (detection.panels[0].element.offsetWidth || 430) + (detection.panels[1].element.offsetWidth || 430)
        : undefined,
    });
  } finally {
    if (restoreSideBySide) {
      restoreSideBySide();
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
}

/**
 * Core element capture pipeline that produces both the complete interface and
 * individual panel captures with independent scrolling when multi-panel is detected.
 */
async function executeElementCaptureWithPanels(
  targetElement: HTMLElement,
  meta: InterfaceMetadata,
  options: CaptureEngineOptions,
  format: 'png' | 'jpeg',
  quality: number
): Promise<CapturedInterfaceResult[]> {
  const detection = detectInterfacePanels(targetElement, meta.name);
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const results: CapturedInterfaceResult[] = [];

  if (!detection.hasMultiplePanels || options.includePanels === false) {
    const canvas = await captureDomElement(targetElement, {
      scale: options.scale ?? 2,
      fullHeight: options.fullHeight ?? false,
      format,
      quality,
    });

    const dataUrl = canvas.toDataURL(mime, quality);
    const approxBytes = Math.round((dataUrl.length * 3) / 4);

    const singleResult: CapturedInterfaceResult = {
      id: meta.id,
      name: meta.name,
      category: meta.category,
      route: meta.route,
      canvas,
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      sizeBytes: approxBytes,
      formattedSize: formatByteSize(approxBytes),
      capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      format,
      isSuccess: true,
      panelResults: [],
    };

    return [singleResult];
  }

  // 1. Capture the COMPLETE SIDE-BY-SIDE INTERFACE
  const fullCanvas = await captureCompleteSideBySideInterface(targetElement, detection, {
    scale: options.scale ?? 2,
    fullHeight: false,
    format,
    quality,
  });

  const fullDataUrl = fullCanvas.toDataURL(mime, quality);
  const fullBytes = Math.round((fullDataUrl.length * 3) / 4);

  const fullResult: CapturedInterfaceResult = {
    id: `${meta.id}-full`,
    name: `${meta.name} — Full Interface`,
    category: meta.category,
    route: meta.route,
    canvas: fullCanvas,
    dataUrl: fullDataUrl,
    width: fullCanvas.width,
    height: fullCanvas.height,
    sizeBytes: fullBytes,
    formattedSize: formatByteSize(fullBytes),
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    format,
    isSuccess: true,
    panelResults: [],
  };

  results.push(fullResult);

  // 2. Capture EACH PANEL INDIVIDUALLY with INDEPENDENT SCROLLING
  const panelResults: CapturedInterfaceResult[] = [];

  for (const panel of detection.panels) {
    const panelCanvas = await capturePanelWithIndependentScrolling(panel, detection.panels, {
      scale: options.scale ?? 2,
      format,
      quality,
      fullHeight: options.fullHeight ?? true,
    });

    const panelDataUrl = panelCanvas.toDataURL(mime, quality);
    const panelBytes = Math.round((panelDataUrl.length * 3) / 4);

    const pResult: CapturedInterfaceResult = {
      id: `${meta.id}-panel-${panel.index}`,
      name: panel.name,
      category: meta.category,
      route: meta.route,
      canvas: panelCanvas,
      dataUrl: panelDataUrl,
      width: panelCanvas.width,
      height: panelCanvas.height,
      sizeBytes: panelBytes,
      formattedSize: formatByteSize(panelBytes),
      capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      format,
      isSuccess: true,
    };

    panelResults.push(pResult);
    results.push(pResult);
  }

  fullResult.panelResults = panelResults;
  return results;
}

/**
 * Captures the currently active live interface visible on the screen, including
 * both the full side-by-side view and individual panels if multi-panel layout is detected.
 */
export async function captureLiveInterfaceWithPanels(
  currentScreen: ScreenId,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult[]> {
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;
  const meta = getInterfaceById(currentScreen) || {
    id: currentScreen,
    name: 'Current View',
    route: currentScreen,
    category: 'Core',
    description: 'Active screen',
    isAvailable: true,
    isScrollable: true,
    preferredDimensions: { width: 430, height: 932 },
    keywords: [],
  };

  const targetElement =
    (document.getElementById(`screen-container-${currentScreen}`) as HTMLElement) ||
    (document.getElementById('app-main-viewport') as HTMLElement) ||
    (document.getElementById('axon-app-root') as HTMLElement) ||
    document.body;

  try {
    return await executeElementCaptureWithPanels(targetElement, meta, options, format, quality);
  } catch (err: any) {
    console.error(`Failed to capture current interface (${currentScreen}):`, err);
    throw new Error(`Unable to capture current interface: ${err?.message || 'Rendering error'}`);
  }
}

/**
 * Captures a specific interface in the background without navigating the active screen,
 * including both the full side-by-side view and individual panels if multi-panel layout is detected.
 *
 * If the interface has child sub-interfaces (e.g. tabs, drawers, modals, sub-tools) and
 * recursive is not disabled, it recursively captures all nested child interfaces in the hierarchy.
 */
export async function captureInterfaceByIdWithPanels(
  interfaceIdOrRoute: string,
  options: CaptureEngineOptions = {},
  visitedIds: Set<string> = new Set<string>()
): Promise<CapturedInterfaceResult[]> {
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;
  const meta = getInterfaceById(interfaceIdOrRoute);

  if (!meta) {
    throw new Error(`Unrecognized interface identifier: "${interfaceIdOrRoute}".`);
  }

  // Prevent circular traversal
  if (visitedIds.has(meta.id)) {
    return [];
  }
  visitedIds.add(meta.id);

  let lastError: Error | null = null;
  let baseResults: CapturedInterfaceResult[] | null = null;

  // Ensure stage requester is initialized
  const stageRequester = await waitForStageRequester(1500);

  // Strategy 1: Offscreen Stage (preferred background capture)
  if (stageRequester) {
    let stageHandle: StageHandle | null = null;
    let stageElement: HTMLElement | null = null;

    try {
      const stageResponse = await stageRequester(
        meta.route,
        options.fullHeight ?? false,
        meta.id
      );
      if (stageResponse) {
        if ('element' in stageResponse && typeof stageResponse.release === 'function') {
          stageHandle = stageResponse;
          stageElement = stageResponse.element;
        } else if (stageResponse instanceof HTMLElement) {
          stageElement = stageResponse;
        }
      }
    } catch (stageErr: any) {
      console.warn(`Stage setup failed for "${meta.name}":`, stageErr);
      lastError = stageErr;
    }

    if (stageElement) {
      try {
        baseResults = await executeElementCaptureWithPanels(
          stageElement,
          meta,
          options,
          format,
          quality
        );
      } catch (renderErr: any) {
        console.warn(`Stage capture error for "${meta.name}", trying live DOM fallback:`, renderErr);
        lastError = renderErr;
      } finally {
        stageHandle?.release();
      }
    }
  }

  // Strategy 2: Live DOM container lookup for mounted/visited screens
  if (!baseResults) {
    const existingElement =
      document.getElementById(`screen-container-${meta.route}`) ||
      document.getElementById(`screen-container-${meta.id}`);

    if (existingElement) {
      const prevVisibility = existingElement.style.visibility;
      existingElement.style.visibility = 'visible';
      try {
        baseResults = await executeElementCaptureWithPanels(existingElement, meta, options, format, quality);
      } catch (renderErr: any) {
        console.warn(`Live DOM capture failed for "${meta.name}":`, renderErr);
        lastError = renderErr;
      } finally {
        existingElement.style.visibility = prevVisibility;
      }
    }
  }

  // Strategy 3: Direct DOM lookup for modals, overlays, or tools matching interface ID
  if (!baseResults && typeof document !== 'undefined') {
    const directElement =
      document.getElementById(meta.id) ||
      (meta.parent ? document.getElementById(`screen-container-${meta.parent}`) : null);

    if (directElement && directElement instanceof HTMLElement) {
      try {
        baseResults = await executeElementCaptureWithPanels(directElement, meta, options, format, quality);
      } catch (renderErr: any) {
        console.warn(`Component capture failed for "${meta.name}":`, renderErr);
        lastError = renderErr;
      }
    }
  }

  if (!baseResults || baseResults.length === 0) {
    throw new Error(
      `Screenshot generation failed for "${meta.name}": ${lastError?.message || 'Interface could not be staged or found in active DOM'}`
    );
  }

  const allResults: CapturedInterfaceResult[] = [...baseResults];

  // Strategy 4: Recursive traversal of child interfaces (nested tabs, drawers, panels, sub-tools)
  if (options.recursive !== false && meta.childrenIds && meta.childrenIds.length > 0) {
    for (const childId of meta.childrenIds) {
      if (!visitedIds.has(childId)) {
        // Small yield to keep UI responsive and prevent thread blocking
        await new Promise((r) => setTimeout(r, 40));
        try {
          const childResults = await captureInterfaceByIdWithPanels(childId, options, visitedIds);
          allResults.push(...childResults);
        } catch (childErr: any) {
          console.warn(`Recursive capture of child "${childId}" failed:`, childErr);
        }
      }
    }
  }

  return allResults;
}

/**
 * Captures the currently active live interface visible on the screen.
 * Returns the primary capture result, which contains panelResults if multi-panel layout was present.
 */
export async function captureLiveCurrentInterface(
  currentScreen: ScreenId,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult> {
  const results = await captureLiveInterfaceWithPanels(currentScreen, options);
  return results[0];
}

/**
 * Captures a specific interface in the background without navigating the user's active screen.
 * Returns the primary capture result, which contains panelResults if multi-panel layout was present.
 */
export async function captureInterfaceById(
  interfaceIdOrRoute: string,
  options: CaptureEngineOptions = {}
): Promise<CapturedInterfaceResult> {
  const results = await captureInterfaceByIdWithPanels(interfaceIdOrRoute, options);
  return results[0];
}

/**
 * Captures all registered AXON interfaces in deterministic hierarchy order.
 * Follows Requirement 15: Continues if one interface fails, reporting successes and failures at the end.
 * Multi-panel interfaces automatically produce both full side-by-side views and individual panel captures.
 */
export async function captureAllInterfaces(
  options: CaptureEngineOptions = {}
): Promise<MultiCaptureReport> {
  const startTime = Date.now();
  const results: CapturedInterfaceResult[] = [];
  const failures: Array<{ name: string; route: string; error: string }> = [];
  const visitedIds = new Set<string>();

  const targets = discoverAvailableInterfaces().filter((i) => i.isAvailable);
  const total = targets.length;
  let processedCount = 0;

  for (const meta of targets) {
    if (visitedIds.has(meta.id)) continue;

    options.onProgress?.({
      current: Math.min(processedCount + 1, total),
      total,
      interfaceName: meta.name,
      percent: Math.min(100, Math.round(((processedCount + 1) / total) * 100)),
    });

    try {
      const itemResults = await captureInterfaceByIdWithPanels(meta.id, options, visitedIds);
      results.push(...itemResults);
      processedCount += itemResults.length;
    } catch (err: any) {
      processedCount++;
      console.warn(`Interface capture failed for "${meta.name}":`, err);
      failures.push({
        name: meta.name,
        route: meta.route,
        error: err?.message || 'Unknown capture error',
      });
    }

    // Small yield to keep UI responsive and prevent frame freezing
    await new Promise((r) => setTimeout(r, 40));
  }

  const duration = Date.now() - startTime;
  return {
    results,
    successfulCount: results.length,
    failedCount: failures.length,
    failures,
    totalDurationMs: duration,
  };
}

/**
 * Stitches an array of captured interface canvases vertically into a continuous long image.
 */
export async function stitchCanvasesVertically(
  captures: CapturedInterfaceResult[],
  options: { gap?: number; banner?: boolean; format?: 'png' | 'jpeg'; quality?: number } = {}
): Promise<{ canvas: HTMLCanvasElement; dataUrl: string; width: number; height: number; filename: string }> {
  if (captures.length === 0) {
    throw new Error('No captures provided to stitch.');
  }

  // Deduplicate strictly by capture ID
  const seenIds = new Set<string>();
  const uniqueCaptures: CapturedInterfaceResult[] = [];
  for (const cap of captures) {
    if (!seenIds.has(cap.id)) {
      seenIds.add(cap.id);
      uniqueCaptures.push(cap);
    }
  }

  const gap = options.gap ?? 28;
  const hasBanner = options.banner ?? true;
  const bannerHeight = hasBanner ? 56 : 0;
  const format = options.format || 'png';
  const quality = options.quality ?? 0.92;

  // Compute maximum width across all canvases
  const maxWidth = Math.max(...uniqueCaptures.map((c) => c.canvas.width), 800);

  // Compute total canvas height
  let totalHeight = 40; // Top margin
  for (const cap of uniqueCaptures) {
    totalHeight += bannerHeight + cap.canvas.height + gap;
  }
  totalHeight += 40; // Bottom margin

  const master = document.createElement('canvas');
  master.width = maxWidth;
  master.height = totalHeight;
  const ctx = master.getContext('2d');
  if (!ctx) throw new Error('Failed to create canvas 2D context.');

  // Render solid dark background
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, master.width, master.height);

  let currentY = 40;

  for (let i = 0; i < uniqueCaptures.length; i++) {
    const cap = uniqueCaptures[i];

    if (hasBanner) {
      // Header banner card background
      ctx.fillStyle = '#171717';
      ctx.fillRect(0, currentY, maxWidth, bannerHeight);

      // Top divider line
      ctx.fillStyle = '#262626';
      ctx.fillRect(0, currentY, maxWidth, 1);

      // Interface Number & Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${cap.name}`, 24, currentY + 34);

      // Category Badge
      ctx.font = '600 14px monospace';
      ctx.fillStyle = '#a3a3a3';
      ctx.textAlign = 'right';
      ctx.fillText(`[${cap.category.toUpperCase()}] • ${cap.width}x${cap.height}px`, maxWidth - 24, currentY + 34);

      currentY += bannerHeight;
    }

    // Draw the actual captured interface canvas centered
    const offsetX = Math.max(0, Math.floor((maxWidth - cap.canvas.width) / 2));
    ctx.drawImage(cap.canvas, offsetX, currentY);

    currentY += cap.canvas.height + gap;
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const dataUrl = master.toDataURL(mime, quality);

  return {
    canvas: master,
    dataUrl,
    width: master.width,
    height: master.height,
    filename: getSafeInterfaceFileName('All_Interfaces', format === 'jpeg' ? 'jpg' : 'png', true),
  };
}

/**
 * Compiles captures into a multi-page PDF document using jsPDF.
 * Creates one page per captured interface with crisp native dimensions.
 */
export async function exportCapturesToPdf(
  captures: CapturedInterfaceResult[],
  customFilename?: string
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  if (captures.length === 0) {
    throw new Error('No captures provided for PDF export.');
  }

  // Deduplicate strictly by capture ID to guarantee no repeated pages
  const seenIds = new Set<string>();
  const uniqueCaptures: CapturedInterfaceResult[] = [];
  for (const cap of captures) {
    if (!seenIds.has(cap.id)) {
      seenIds.add(cap.id);
      uniqueCaptures.push(cap);
    }
  }

  const filename = customFilename || 'AXON_Interface_Documentation.pdf';

  // Instantiate jsPDF with first page dimensions
  const first = uniqueCaptures[0];
  const isFirstLandscape = first.canvas.width > first.canvas.height;

  const pdf = new jsPDF({
    orientation: isFirstLandscape ? 'landscape' : 'portrait',
    unit: 'px',
    format: [first.canvas.width, first.canvas.height],
    hotfixes: ['px_scaling'],
  });

  // Add first page image
  const firstImgData = first.canvas.toDataURL('image/png');
  pdf.addImage(firstImgData, 'PNG', 0, 0, first.canvas.width, first.canvas.height, undefined, 'FAST');

  // Add remaining pages
  for (let i = 1; i < uniqueCaptures.length; i++) {
    const item = uniqueCaptures[i];
    const isLandscape = item.canvas.width > item.canvas.height;
    pdf.addPage([item.canvas.width, item.canvas.height], isLandscape ? 'landscape' : 'portrait');
    const imgData = item.canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, item.canvas.width, item.canvas.height, undefined, 'FAST');
  }

  const blob = pdf.output('blob');
  const dataUrl = pdf.output('dataurlstring');

  return {
    blob,
    dataUrl,
    filename,
  };
}

/**
 * Triggers a browser download for a dataUrl.
 */
export function triggerCaptureDownload(dataUrl: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export function buildResultFileFromCapture(
  result: CapturedInterfaceResult,
  formatOverride?: 'png' | 'jpg'
): GeneratedResultFile {
  const ext = formatOverride || (result.format === 'jpeg' ? 'jpg' : 'png');
  const fileName = getSafeInterfaceFileName(result.name, ext);
  return {
    id: `${result.id}-${ext}`,
    interfaceName: result.name,
    category: result.category,
    route: result.route,
    status: result.isSuccess ? 'success' : 'failed',
    errorMessage: result.error,
    fileName,
    fileFormat: ext.toUpperCase() as 'PNG' | 'JPG',
    fileType: ext === 'jpg' ? 'image/jpeg' : 'image/png',
    fileSize: result.formattedSize,
    dimensions: `${result.width} × ${result.height} px`,
    dataUrl: result.dataUrl,
    capturedAt: result.capturedAt,
  };
}

export function buildResultFileFromPdf(
  pdfDoc: { dataUrl: string; filename: string; blob?: Blob },
  interfaceName: string,
  category = 'Documentation',
  route = 'all',
  pageCount?: number
): GeneratedResultFile {
  const approxBytes = Math.round((pdfDoc.dataUrl.length * 3) / 4);
  return {
    id: `pdf-${pdfDoc.filename}`,
    interfaceName,
    category,
    route,
    status: 'success',
    fileName: pdfDoc.filename,
    fileFormat: 'PDF',
    fileType: 'application/pdf',
    fileSize: formatByteSize(approxBytes),
    dimensions: pageCount ? `${pageCount} page${pageCount > 1 ? 's' : ''}` : 'Document',
    dataUrl: pdfDoc.dataUrl,
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function buildResultFileFromStitched(
  stitched: { dataUrl: string; filename: string; width: number; height: number; format?: 'png' | 'jpeg' },
  interfaceName: string,
  category = 'Combined View',
  route = 'all'
): GeneratedResultFile {
  const approxBytes = Math.round((stitched.dataUrl.length * 3) / 4);
  const ext = stitched.filename.endsWith('.jpg') ? 'JPG' : 'PNG';
  return {
    id: `stitched-${stitched.filename}`,
    interfaceName,
    category,
    route,
    status: 'success',
    fileName: stitched.filename,
    fileFormat: ext,
    fileType: ext === 'JPG' ? 'image/jpeg' : 'image/png',
    fileSize: formatByteSize(approxBytes),
    dimensions: `${stitched.width} × ${stitched.height} px`,
    dataUrl: stitched.dataUrl,
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export function buildFailureResultFile(
  name: string,
  route: string,
  error: string,
  category = 'Interface'
): GeneratedResultFile {
  return {
    id: `fail-${route}-${Date.now()}`,
    interfaceName: name,
    category,
    route,
    status: 'failed',
    errorMessage: error,
    fileName: `${name.replace(/\s+/g, '_')}_FAILED.txt`,
    fileFormat: 'PNG',
    fileType: 'text/plain',
    fileSize: '0 B',
    dimensions: 'Unavailable',
    capturedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

