import { useEffect, useState } from 'react';
import { useCubeStore } from './store/useCubeStore';
import { useAppStore } from './store/useAppStore';
import { initializeDatabase } from './db/index';
import { getAllProfiles } from './db/repository';
import type { Profile } from './types/db';
import { Header } from './components/Header';
import { ModeTabs } from './components/ModeTabs';
import { ScrambleView } from './components/views/ScrambleView';
import { TimedSolveView } from './components/views/TimedSolveView';
import { GuidedSolveView } from './components/views/GuidedSolveView';
import { HistoryView } from './components/views/HistoryView';
import { ConnectionModal } from './components/ConnectionModal';
import { ProfileModal } from './components/ProfileModal';

export function App() {
  const { init: initCubeStore } = useCubeStore();
  const { activeMode, currentProfileId, setProfileId, isProfileModalOpen, setIsProfileModalOpen } = useAppStore();

  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [profileName, setProfileName] = useState('Main Profile');

  // Initialize DB and Cube Model on mount
  useEffect(() => {
    const setup = async () => {
      const defaultProfId = await initializeDatabase();
      setProfileId(defaultProfId);
      await initCubeStore();
    };
    setup();
  }, [initCubeStore, setProfileId]);

  // Sync profile name
  useEffect(() => {
    const fetchProfileName = async () => {
      const profiles = await getAllProfiles();
      const active = profiles.find((p: Profile) => p.id === currentProfileId);
      if (active) setProfileName(active.name);
    };
    fetchProfileName();
  }, [currentProfileId, isProfileModalOpen]);

  return (
    <div className="min-h-screen bg-[#0A0A0D] flex items-center justify-center p-0 sm:p-6 font-sans">
      {/* Mobile-first centered phone frame */}
      <div className="w-full sm:max-w-[420px] min-h-screen sm:min-h-[760px] sm:max-h-[94vh] bg-[var(--bg)] sm:rounded-[36px] sm:border border-[#2A2C34] px-4 py-5 sm:px-5 sm:py-6 flex flex-col justify-between text-[var(--text)] shadow-2xl overflow-y-auto relative">
        <Header
          onOpenConnectionModal={() => setIsConnectionModalOpen(true)}
          onOpenProfileModal={() => setIsProfileModalOpen(true)}
          profileName={profileName}
        />

        <ModeTabs />

        <main className="flex-1 flex flex-col min-h-0">
          {activeMode === 'scramble' && <ScrambleView />}
          {activeMode === 'timed' && <TimedSolveView />}
          {activeMode === 'guided' && <GuidedSolveView />}
          {activeMode === 'history' && <HistoryView />}
        </main>


        {/* Modals */}
        <ConnectionModal
          isOpen={isConnectionModalOpen}
          onClose={() => setIsConnectionModalOpen(false)}
        />

        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      </div>
    </div>
  );
}

export default App;
