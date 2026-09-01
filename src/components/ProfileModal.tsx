import React, { useState, useEffect } from 'react';
import { User, Plus, Check, Trash2, X, Pencil } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { getAllProfiles, createProfile, deleteProfile, updateProfile, getProfileStats } from '../db/repository';
import type { Profile } from '../types/db';
import { formatTime } from '../utils/telemetryCalculator';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { currentProfileId, setProfileId } = useAppStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileStats, setProfileStats] = useState<Record<string, { solveCount: number; bestTime: number | null }>>({});
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const loadProfiles = async () => {
    try {
      const list = await getAllProfiles();
      setProfiles(list);

      const statsMap: Record<string, { solveCount: number; bestTime: number | null }> = {};
      for (const p of list) {
        statsMap[p.id] = await getProfileStats(p.id);
      }
      setProfileStats(statsMap);
    } catch (err) {
      console.warn('Failed to load profiles:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProfiles();
      setIsCreating(false);
      setEditingProfileId(null);
    }
  }, [isOpen]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    try {
      const created = await createProfile(newProfileName.trim());
      setNewProfileName('');
      setIsCreating(false);
      await loadProfiles();
      setProfileId(created.id);
    } catch (err) {
      console.error('Failed to create profile:', err);
    }
  };

  const handleStartRename = (p: Profile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProfileId(p.id);
    setEditingName(p.name);
  };

  const handleSaveRename = async (id: string, e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!editingName.trim()) return;

    try {
      await updateProfile(id, editingName.trim());
      setEditingProfileId(null);
      await loadProfiles();
    } catch (err) {
      console.error('Failed to rename profile:', err);
    }
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProfileId(null);
  };

  const handleDelete = async (p: Profile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (profiles.length <= 1) {
      alert('You must keep at least one profile.');
      return;
    }
    const count = profileStats[p.id]?.solveCount ?? 0;
    const msg = count > 0
      ? `Delete profile "${p.name}" and all ${count} of its solves?`
      : `Delete profile "${p.name}"?`;
    if (confirm(msg)) {
      await deleteProfile(p.id);
      if (currentProfileId === p.id) {
        const remaining = profiles.filter((item) => item.id !== p.id);
        if (remaining.length > 0) setProfileId(remaining[0].id);
      }
      await loadProfiles();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 text-[var(--text)] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <User className="w-5 h-5 text-[var(--white)]" />
            <h2 className="font-heading font-semibold text-base">User Profiles</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 mb-4 max-h-[260px] overflow-y-auto">
          {profiles.map((p) => {
            const isSelected = p.id === currentProfileId;
            const isEditing = editingProfileId === p.id;
            const stats = profileStats[p.id];

            if (isEditing) {
              return (
                <form
                  key={p.id}
                  onSubmit={(e) => handleSaveRename(p.id, e)}
                  className="p-2.5 rounded-xl border border-[var(--white)]/40 bg-[var(--surface-2)] flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    autoFocus
                    className="flex-1 px-2.5 py-1 text-sm rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] focus:outline-hidden focus:border-[var(--white)]"
                  />
                  <button
                    type="submit"
                    title="Save name"
                    className="p-1.5 rounded-lg bg-[var(--white)] text-[var(--bg)] hover:opacity-90 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRename}
                    title="Cancel"
                    className="p-1.5 rounded-lg bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              );
            }

            return (
              <div
                key={p.id}
                onClick={() => {
                  setProfileId(p.id);
                  onClose();
                }}
                className={`flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[var(--surface-2)] border-[var(--white)]/30 text-[var(--text)]'
                    : 'bg-[var(--surface-2)]/40 border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-medium text-sm text-[var(--text)] truncate">{p.name}</span>
                    {isSelected && (
                      <span className="px-1.5 py-0.2 shrink-0 rounded text-[10px] bg-[var(--green)]/20 text-[var(--green)]">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono">
                    {stats ? (
                      <span>
                        {stats.solveCount} {stats.solveCount === 1 ? 'solve' : 'solves'}
                        {stats.bestTime !== null ? ` · Best: ${formatTime(stats.bestTime).full}s` : ''}
                      </span>
                    ) : (
                      'Loading…'
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => handleStartRename(p, e)}
                    title="Rename profile"
                    className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer rounded-lg hover:bg-[var(--surface)]"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  {profiles.length > 1 && (
                    <button
                      onClick={(e) => handleDelete(p, e)}
                      title="Delete profile"
                      className="p-1.5 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer rounded-lg hover:bg-[var(--surface)]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isCreating ? (
          <form onSubmit={handleCreate} className="space-y-2 pt-2 border-t border-[var(--border)]">
            <input
              type="text"
              placeholder="Profile name…"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-hidden focus:border-[var(--white)]"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl font-heading font-semibold text-xs bg-[var(--white)] text-[var(--bg)] cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="px-3 py-2 rounded-xl font-heading text-xs bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full py-2.5 rounded-xl font-heading font-medium text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 border border-[var(--border)] text-[var(--text)] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create New Profile</span>
          </button>
        )}
      </div>
    </div>
  );
};

