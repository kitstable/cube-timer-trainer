import React from 'react';
import { Bluetooth, X, AlertCircle, RefreshCw, Unlink } from 'lucide-react';
import { useCubeStore } from '../store/useCubeStore';
import { useAppStore } from '../store/useAppStore';
import { useSmartCube } from '../hooks/useSmartCube';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({ isOpen, onClose }) => {
  const { smartCube } = useCubeStore();
  const { connect, disconnect, resyncFromCube } = useSmartCube();

  if (!isOpen) return null;


  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-sm p-5 text-[var(--text)] shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5 text-[var(--blue)]" />
            <h2 className="font-heading font-semibold text-base">Smart Cube Connection</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {smartCube.isConnected ? (
          <div className="space-y-4">
            <div className="p-3.5 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <span className="font-heading font-medium text-sm text-[var(--text)]">
                  {smartCube.deviceName || 'Smart Cube'}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--green)] font-medium">
                  <span className="w-2 h-2 rounded-full bg-[var(--green)] shadow-[0_0_6px_var(--green)]" />
                  Connected
                </span>
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1 flex items-center justify-between">
                <span>Bluetooth GATT stream active</span>
                {smartCube.batteryLevel !== null && (
                  <span className="font-mono text-[11px] text-[var(--text)]">{smartCube.batteryLevel}% battery</span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await resyncFromCube();
                  onClose();
                }}
                className="flex-1 py-2.5 rounded-xl font-heading font-medium text-xs bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--border)] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Resync from Cube</span>
              </button>

              <button
                onClick={() => {
                  useCubeStore.getState().resetToSolved();
                  useAppStore.getState().setMode('scramble');
                  onClose();
                }}
                className="flex-1 py-2.5 rounded-xl font-heading font-medium text-xs bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--border)] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Calibrate Solved</span>
              </button>
            </div>

            <button
              onClick={() => {
                disconnect();
                onClose();
              }}
              className="w-full py-3 rounded-xl font-heading font-medium text-sm bg-transparent border border-[var(--red)]/40 text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <Unlink className="w-4 h-4" />
              <span>Disconnect Cube</span>
            </button>
          </div>
        ) : (

          <div className="space-y-4">
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Connect your Bluetooth smart cube (QiYi AI, Giiker/Mijia, GAN, GoCube) for automatic solve phase detection and live 3D sync.
            </p>

            {smartCube.error && (
              <div className="p-3 rounded-xl bg-[var(--red)]/10 border border-[var(--red)]/30 text-xs text-[var(--red)] flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{smartCube.error}</span>
              </div>
            )}

            <button
              onClick={async () => {
                await connect();
                if (!useCubeStore.getState().smartCube.error) {
                  onClose();
                }
              }}
              disabled={smartCube.isConnecting}
              className="w-full py-3.5 rounded-xl font-heading font-semibold text-sm bg-[var(--white)] text-[var(--bg)] hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {smartCube.isConnecting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scanning for Smart Cubes…</span>
                </>
              ) : (
                <>
                  <Bluetooth className="w-4 h-4" />
                  <span>Pair Smart Cube (BLE)</span>
                </>
              )}
            </button>

            <div className="text-[11px] text-[var(--text-muted)] space-y-1 pt-1">
              <div className="font-semibold text-[var(--text)]">Bluetooth Pairing Tips:</div>
              <div>• Make sure Bluetooth is enabled on your device</div>
              <div>• Turn a face on your smart cube to wake up its sensors</div>
              <div>• Use Chrome, Edge, or a Web Bluetooth supported browser</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
