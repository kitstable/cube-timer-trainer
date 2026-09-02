import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, X, Check, FileUp } from 'lucide-react';
import { parseHistoryImport, type ImportParseResult, type ParsedImportSolve } from '../utils/historyExportImport';
import { importSolves } from '../db/repository';
import { formatTime } from '../utils/telemetryCalculator';
import { getEffectiveTimeMs } from '../types/db';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (importedCount: number, skippedCount: number) => void;
  profileName: string;
  profileId: string;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
  profileName,
  profileId,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleReset = () => {
    setFileName(null);
    setFileSize(null);
    setParseResult(null);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const processFile = async (file: File) => {
    try {
      setImportError(null);
      setFileName(file.name);
      const sizeKb = (file.size / 1024).toFixed(1);
      setFileSize(`${sizeKb} KB`);

      const text = await file.text();
      const result = parseHistoryImport(text, file.name);
      setParseResult(result);
    } catch (err: any) {
      setImportError(`Failed to read file: ${err.message || String(err)}`);
      setParseResult(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.solves.length === 0) return;

    setIsImporting(true);
    try {
      const { importedCount, skippedCount } = await importSolves(profileId, parseResult.solves, {
        skipDuplicates,
      });

      onImportSuccess(importedCount, skippedCount);
      handleReset();
      onClose();
    } catch (err: any) {
      setImportError(`Import failed: ${err.message || String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg p-5 text-[var(--text)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <FileUp className="w-5 h-5 text-[var(--white)]" />
            <h2 className="font-heading font-semibold text-base">Import Solves History</h2>
          </div>
          <button
            onClick={() => {
              handleReset();
              onClose();
            }}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,text/csv,application/json,text/plain"
            onChange={handleFileChange}
            className="hidden"
          />

          {!parseResult && (
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2.5 ${
                dragActive
                  ? 'border-[var(--green)] bg-[var(--green)]/10'
                  : 'border-[var(--border)] hover:border-[var(--white)]/50 bg-[var(--surface-2)]/40 hover:bg-[var(--surface-2)]'
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-[var(--text)]">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <div className="font-heading font-medium text-sm text-[var(--text)]">
                  Click to select or drag and drop a file
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  Supports <strong>Cube Trainer JSON / CSV</strong> and <strong>csTimer JSON / CSV</strong>
                </div>
              </div>
            </div>
          )}

          {importError && (
            <div className="p-3 rounded-xl bg-[var(--red)]/10 border border-[var(--red)]/30 text-[var(--red)] text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{importError}</div>
            </div>
          )}

          {parseResult && (
            <div className="space-y-3">
              {/* File details card */}
              <div className="p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="w-5 h-5 text-[var(--white)] shrink-0" />
                  <div className="truncate">
                    <div className="text-xs font-medium text-[var(--text)] truncate">{fileName}</div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono">{fileSize}</div>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] cursor-pointer"
                >
                  Change File
                </button>
              </div>

              {/* Parse status & format badge */}
              {parseResult.success ? (
                <div className="p-3 bg-[var(--green)]/10 border border-[var(--green)]/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--green)]">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Ready to Import</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/40">
                      {parseResult.formatLabel}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--text)]">
                    Found <strong>{parseResult.solves.length}</strong> {parseResult.solves.length === 1 ? 'solve' : 'solves'} ready to import into profile <strong>"{profileName}"</strong>.
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-xl space-y-1 text-xs text-[var(--red)]">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    <span>No Valid Solves Found</span>
                  </div>
                  {parseResult.errors.map((err, i) => (
                    <div key={i} className="text-[11px]">{err}</div>
                  ))}
                </div>
              )}

              {/* Duplicate Protection Checkbox */}
              {parseResult.success && (
                <label className="flex items-center gap-2 p-2.5 bg-[var(--surface-2)]/60 border border-[var(--border)] rounded-xl cursor-pointer text-xs select-none">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded border-[var(--border)] text-[var(--green)] focus:ring-0 cursor-pointer"
                  />
                  <div className="flex-1">
                    <span className="font-medium text-[var(--text)]">Skip duplicate solves</span>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Prevents adding solves that already exist in your history
                    </span>
                  </div>
                </label>
              )}

              {/* Solves Preview list */}
              {parseResult.success && parseResult.solves.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-heading font-medium text-[var(--text-muted)] uppercase tracking-wider px-1">
                    Preview (First {Math.min(parseResult.solves.length, 5)} solves)
                  </div>
                  <div className="max-h-[160px] overflow-y-auto bg-[var(--surface-2)]/40 border border-[var(--border)] rounded-xl divide-y divide-[var(--border)]">
                    {parseResult.solves.slice(0, 5).map((solve: ParsedImportSolve, idx: number) => {
                      const effectiveTime = getEffectiveTimeMs(solve);
                      const timeStr = formatTime(effectiveTime).full;
                      const dateStr = new Date(solve.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      });
                      const scrambleStr = solve.scrambleMoves.join(' ');

                      return (
                        <div key={idx} className="p-2.5 text-xs flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-[var(--text)]">
                                {solve.dnf ? 'DNF' : `${timeStr}s`}
                                {solve.plusTwo && <span className="text-[var(--orange)] ml-1">+2</span>}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">{dateStr}</span>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono truncate mt-0.5 max-w-[280px]">
                              {scrambleStr || 'No scramble'}
                            </div>
                          </div>
                          {solve.phases && solve.phases.length > 0 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/30">
                              CFOP Splits
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => {
              handleReset();
              onClose();
            }}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface-2)] hover:bg-[var(--surface-2)]/80 transition-colors cursor-pointer"
          >
            Cancel
          </button>

          {parseResult?.success && (
            <button
              type="button"
              disabled={isImporting || parseResult.solves.length === 0}
              onClick={handleConfirmImport}
              className="px-4 py-2 rounded-xl text-xs font-heading font-semibold bg-[var(--white)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              {isImporting ? (
                <span>Importing…</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Import {parseResult.solves.length} {parseResult.solves.length === 1 ? 'Solve' : 'Solves'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
