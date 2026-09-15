import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { registerOffscreenStageRequester, StageHandle } from '../lib/interfaceCaptureEngine';
import {
  getInterfaceComponent,
  registerInterfaceComponent,
  unregisterInterfaceComponent,
} from '../lib/interfaceComponentRegistry';

// Backwards compatibility re-exports for dynamic registration
export function registerDynamicStageComponent(
  route: string,
  component: React.ComponentType<any>
): void {
  registerInterfaceComponent(route, component);
}

export function unregisterDynamicStageComponent(route: string): void {
  unregisterInterfaceComponent(route);
}

interface QueuedStageRequest {
  id: number;
  route: string;
  isFull: boolean;
  interfaceId?: string;
  resolve: (handle: StageHandle | null) => void;
  reject: (err: any) => void;
}

let requestIdCounter = 0;

/**
 * Isolated error boundary for staged offscreen components.
 * Prevents any single screen render issue from unmounting the stage
 * or stalling the capture queue.
 */
class StageErrorBoundary extends React.Component<
  { children: React.ReactNode; route: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; route: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn(`Stage component error caught for route "${this.props.route}":`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center p-6 text-center bg-neutral-950 text-neutral-300 font-mono text-xs border border-neutral-800 rounded-lg m-4">
          <div className="text-amber-400 font-semibold text-sm mb-2">Interface Render Notice</div>
          <div className="text-neutral-400 max-w-[340px] break-words">
            {this.state.error?.message || 'Component tree produced a rendering exception in stage'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const InterfaceCaptureOffscreenStage: React.FC = () => {
  const { theme } = useApp();
  const [activeRequest, setActiveRequest] = useState<QueuedStageRequest | null>(null);
  const queueRef = useRef<QueuedStageRequest[]>([]);
  const isBusyRef = useRef<boolean>(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const processQueue = useCallback(() => {
    if (isBusyRef.current) return;
    if (queueRef.current.length === 0) {
      setActiveRequest(null);
      return;
    }

    const next = queueRef.current.shift()!;
    isBusyRef.current = true;
    setActiveRequest(next);
  }, []);

  const releaseCurrentRequest = useCallback(() => {
    isBusyRef.current = false;
    processQueue();
  }, [processQueue]);

  useEffect(() => {
    // Register the FIFO queue-backed offscreen stage requester
    registerOffscreenStageRequester(
      (route: string, isFull: boolean, interfaceId?: string) => {
        return new Promise<StageHandle | null>((resolve, reject) => {
          const item: QueuedStageRequest = {
            id: ++requestIdCounter,
            route,
            isFull,
            interfaceId,
            resolve,
            reject,
          };
          queueRef.current.push(item);
          processQueue();
        });
      }
    );

    return () => {
      registerOffscreenStageRequester(null);
      queueRef.current = [];
      isBusyRef.current = false;
    };
  }, [processQueue]);

  // When activeRequest changes, wait for DOM layout and resolve with release handle
  useEffect(() => {
    if (!activeRequest) return;

    let isMounted = true;
    let hasReleased = false;

    const safeRelease = () => {
      if (hasReleased) return;
      hasReleased = true;
      releaseCurrentRequest();
    };

    // Watchdog timer: If caller fails to release within 12s, release automatically to prevent stalled queue
    const watchdogTimer = setTimeout(() => {
      if (!hasReleased && isMounted) {
        console.warn(`Stage watchdog auto-released request for "${activeRequest.route}"`);
        safeRelease();
      }
    }, 12000);

    // Wait 100ms + 2 animation frames for children to mount and compute styles
    const renderTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isMounted || hasReleased) return;

          const el = stageRef.current;
          if (el) {
            activeRequest.resolve({
              element: el,
              release: safeRelease,
            });
          } else {
            activeRequest.reject(
              new Error(`Stage element unavailable for route "${activeRequest.route}"`)
            );
            safeRelease();
          }
        });
      });
    }, 100);

    return () => {
      isMounted = false;
      clearTimeout(renderTimer);
      clearTimeout(watchdogTimer);
    };
  }, [activeRequest, releaseCurrentRequest]);

  if (!activeRequest) {
    return null;
  }

  const { route, isFull, interfaceId } = activeRequest;
  // Dynamically resolve component from the authoritative registry: prioritize specific interfaceId first, then route
  const Component =
    (interfaceId ? getInterfaceComponent(interfaceId) : null) ||
    getInterfaceComponent(route);

  const formattedTitle = (interfaceId || route).replace(/[_/]/g, ' ').toUpperCase();
  const isOverlay = route.includes('drawer') || route.includes('modal');

  return (
    <div
      id="axon-offscreen-capture-stage"
      data-capture-stage="true"
      ref={stageRef}
      style={{
        position: 'fixed',
        left: '-99999px',
        top: 0,
        width: isOverlay ? 'auto' : '430px',
        minWidth: isOverlay ? '320px' : '430px',
        height: isFull ? 'auto' : '932px',
        minHeight: '932px',
        zIndex: -99999,
        visibility: 'visible',
        pointerEvents: 'none',
        overflow: isFull ? 'visible' : 'hidden',
      }}
      className={`flex flex-col font-sans select-none ${
        theme.mode === 'dark' ? 'bg-black text-white' : 'bg-neutral-100 text-neutral-900'
      }`}
      aria-hidden="true"
    >
      {/* Offscreen Top Header Bar for full screens */}
      {!isOverlay && (
        <div className="h-12 w-full bg-black border-b border-neutral-800 px-3 flex items-center justify-between shrink-0">
          <span className="text-xs font-bold tracking-tight text-white">
            AXON • {formattedTitle}
          </span>
          <span className="text-[10px] font-mono text-neutral-400">UI PREVIEW</span>
        </div>
      )}

      {/* Screen Component with Isolated Error Boundary */}
      <div
        className={`flex-1 min-h-0 flex flex-col ${
          isFull ? 'h-auto overflow-visible' : 'overflow-hidden'
        }`}
      >
        <StageErrorBoundary route={route} key={`${route}-${interfaceId || ''}`}>
          {Component ? (
            <Component />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-neutral-500 text-xs font-mono">
              Interface component for &quot;{route}&quot; not registered
            </div>
          )}
        </StageErrorBoundary>
      </div>
    </div>
  );
};
