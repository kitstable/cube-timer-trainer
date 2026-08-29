import React, { useState, useEffect } from 'react';
import { User, Plus, Check, Trash2, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { getAllProfiles, createProfile, deleteProfile } from '../db/repository';
import type { Profile } from '../types/db';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { currentProfileId, setProfileId } = useAppStore();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadProfiles = async () => {
    try {
      const list = await getAllProfiles();
      setProfiles(list);
    } catch (err) {
      console.warn('Failed to load profiles:', err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProfiles();
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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (profiles.length <= 1) {
      alert('You must keep at least one profile.');
      return;
    }
    if (confirm('Delete this profile and all its solves?')) {
      await deleteProfile(id);
      if (currentProfileId === id) {
        const remaining = profiles.filter((p) => p.id !== id);
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

        <div className="space-y-2 mb-4 max-h-[220px] overflow-y-auto">
          {profiles.map((p) => {
            const isSelected = p.id === currentProfileId;
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
                <div className="flex items-center gap-2.5">
                  <span className="font-sans font-medium text-sm text-[var(--text)]">{p.name}</span>
                  {isSelected && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--green)]/20 text-[var(--green)]">
                      Active
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {isSelected && <Check className="w-4 h-4 text-[var(--green)]" />}
                  {profiles.length > 1 && (
                    <button
                      onClick={(e) => handleDelete(p.id, e)}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer"
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
