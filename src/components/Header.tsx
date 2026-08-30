import React, { useState } from 'react';
import { User, RefreshCw } from 'lucide-react';
import { useCubeStore } from '../store/useCubeStore';
import { useSmartCube } from '../hooks/useSmartCube';

interface HeaderProps {
  onOpenConnectionModal: () => void;
  onOpenProfileModal: () => void;
  profileName: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenConnectionModal,
  onOpenProfileModal,
  profileName,
}) => {
  const { smartCube } = useCubeStore();
  const { resyncFromCube } = useSmartCube();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await resyncFromCube();
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="w-full flex items-center justify-between py-2 px-1 mb-3 text-xs font-mono text-[var(--text-muted)]">
      <button
        onClick={onOpenProfileModal}
        className="flex items-center gap-1 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-2.5 py-1 text-[11px] text-[var(--text)] transition-colors cursor-pointer"
      >
        <User className="w-3 h-3 text-[var(--text-muted)]" />
        <span className="max-w-[90px] truncate">{profileName}</span>
      </button>

      <div className="flex items-center gap-1.5">
        {smartCube.isConnected && (
          <button
            onClick={handleSync}
            disabled={isSyncing}
            title="Resync from cube"
            aria-label="Resync from cube"
            className="flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] rounded-full w-[26px] h-[26px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-60"
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
    </header>
  );
};
