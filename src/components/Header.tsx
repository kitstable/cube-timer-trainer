import React, { useState } from 'react';
import { User, RefreshCw } from 'lucide-react';
import { useCubeStore } from '../store/useCubeStore';
import { useSmartCube } from '../hooks/useSmartCube';

interface HeaderProps {
  onOpenConnectionModal: () => void;
  onOpenProfileModal: () => void;
  profileName: string;
  children?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenConnectionModal,
  onOpenProfileModal,
  profileName,
  children,
}) => {
  const { smartCube } = useCubeStore();
  const { resyncFromCube, hasActiveConnection } = useSmartCube();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (isSyncing) return;

    // If BLE reference was lost or disconnected, open modal to reconnect
    if (!hasActiveConnection()) {
      onOpenConnectionModal();
      return;
    }

    // If cube protocol doesn't support reading physical state over GATT, open modal for manual calibration
    if (!smartCube.stateReadSupported) {
      onOpenConnectionModal();
      return;
    }

    setIsSyncing(true);
    try {
      await Promise.all([
        resyncFromCube(),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ]);

      if (!useCubeStore.getState().smartCube.stateReadSupported) {
        onOpenConnectionModal();
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="w-full flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3 lg:mb-5 text-xs font-mono text-[var(--text-muted)]">
      <div className="flex items-center justify-between w-full lg:w-auto">
        <button
          onClick={onOpenProfileModal}
          className="flex items-center gap-1.5 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-xs text-[var(--text)] transition-colors cursor-pointer"
        >
          <User className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="max-w-[110px] lg:max-w-[130px] truncate">{profileName}</span>
        </button>

        {/* Mobile-only right side connection action */}
        <div className="flex lg:hidden items-center gap-1.5">
          {smartCube.isConnected && (
            <button
              onClick={handleSync}
              disabled={isSyncing}
              title="Resync from cube"
              aria-label="Resync from cube"
              className="flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] rounded-full w-[28px] h-[28px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
            </button>
          )}

          <button
            onClick={onOpenConnectionModal}
            className={`flex items-center gap-1.5 border rounded-full px-2.5 py-1 text-[11px] font-sans font-medium transition-all cursor-pointer ${
              smartCube.isConnected
                ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--green)]'
                : smartCube.isConnecting
                ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--yellow)]'
                : 'bg-[var(--surface)] hover:bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                smartCube.isConnected
                  ? 'bg-[var(--green)] shadow-[0_0_6px_var(--green)]'
                  : smartCube.isConnecting
                  ? 'bg-[var(--yellow)] animate-pulse'
                  : 'bg-[var(--text-muted)]'
              }`}
            />
            <span className="truncate max-w-[120px]">
              {smartCube.isConnected
                ? smartCube.deviceName || 'Smart Cube'
                : smartCube.isConnecting
                ? 'Connecting…'
                : 'Connect Cube'}
            </span>
          </button>
        </div>
      </div>

      {children && (
        <div className="w-full lg:w-auto lg:flex-1 lg:max-w-md lg:mx-4">
          {children}
        </div>
      )}

      {/* Desktop-only right side connection action */}
      <div className="hidden lg:flex items-center gap-2">
        {smartCube.isConnected && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            title="Resync from cube"
            aria-label="Resync from cube"
            className="flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] rounded-full w-[32px] h-[32px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>
        )}

        <button
          onClick={onOpenConnectionModal}
          className={`flex items-center gap-2 border rounded-full px-3.5 py-1.5 text-xs font-sans font-medium transition-all cursor-pointer ${
            smartCube.isConnected
              ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--green)]'
              : smartCube.isConnecting
              ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--yellow)]'
              : 'bg-[var(--surface)] hover:bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              smartCube.isConnected
                ? 'bg-[var(--green)] shadow-[0_0_6px_var(--green)]'
                : smartCube.isConnecting
                ? 'bg-[var(--yellow)] animate-pulse'
                : 'bg-[var(--text-muted)]'
            }`}
          />
          <span className="truncate max-w-[140px]">
            {smartCube.isConnected
              ? smartCube.deviceName || 'Smart Cube'
              : smartCube.isConnecting
              ? 'Connecting…'
              : 'Connect Cube'}
          </span>
        </button>
      </div>
    </header>
  );
};
