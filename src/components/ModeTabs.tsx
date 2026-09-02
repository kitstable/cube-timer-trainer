import React from 'react';
import type { AppMode } from '../types/cube';
import { useAppStore } from '../store/useAppStore';

const TABS: { id: AppMode; label: string }[] = [
  { id: 'scramble', label: 'Scramble' },
  { id: 'timed', label: 'Timed' },
  { id: 'guided', label: 'Guided' },
  { id: 'training', label: 'Training' },
  { id: 'history', label: 'History' },
];

export const ModeTabs: React.FC = () => {
  const { activeMode, setMode } = useAppStore();

  return (
    <nav className="flex gap-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-1 w-full">
      {TABS.map((tab) => {
        const isActive = activeMode === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setMode(tab.id)}
            className={`flex-1 py-1.5 lg:py-2 text-center font-heading text-xs lg:text-[13px] font-medium rounded-lg transition-all cursor-pointer ${
              isActive
                ? 'bg-[var(--surface-2)] text-[var(--text)] shadow-xs font-semibold'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
