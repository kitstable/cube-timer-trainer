import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { useCubeStore } from '../store/useCubeStore';

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
  const [timeStr, setTimeStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="w-full flex items-center justify-between py-2 px-1 mb-3 text-xs font-mono text-[var(--text-muted)]">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-[var(--text)]">{timeStr || '9:41'}</span>
        <button
          onClick={onOpenProfileModal}
          className="flex items-center gap-1 bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-2.5 py-1 text-[11px] text-[var(--text)] transition-colors cursor-pointer"
        >
          <User className="w-3 h-3 text-[var(--text-muted)]" />
          <span className="max-w-[90px] truncate">{profileName}</span>
        </button>
      </div>

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
    </header>
  );
};
