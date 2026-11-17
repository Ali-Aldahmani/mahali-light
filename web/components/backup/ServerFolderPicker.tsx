'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowUp, ChevronRight, Folder, FolderPlus, HardDrive, Home, AlertTriangle,
} from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import {
  browseServerFolders, createServerFolder, type ServerFolderListing,
} from '@/services/backupService';
import { cn } from '@/lib/utils/cn';

// Breadcrumb pieces for an absolute path, each with the path it opens.
function crumbs(full: string, sep: string) {
  const out: { label: string; path: string }[] = [];
  if (sep === '\\') {
    const m = full.match(/^([A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\?)/);
    const root = m ? m[1] : '';
    if (root) out.push({ label: root.replace(/\\$/, ''), path: root.endsWith('\\') ? root : `${root}\\` });
    let acc = root.endsWith('\\') ? root : `${root}\\`;
    full.slice(root.length).split('\\').filter(Boolean).forEach((part) => {
      acc = acc.endsWith('\\') ? `${acc}${part}` : `${acc}\\${part}`;
      out.push({ label: part, path: acc });
    });
  } else {
    out.push({ label: '/', path: '/' });
    let acc = '';
    full.split('/').filter(Boolean).forEach((part) => {
      acc = `${acc}/${part}`;
      out.push({ label: part, path: acc });
    });
  }
  return out;
}

export default function ServerFolderPicker({
  open,
  initialPath,
  onCancel,
  onSelect,
}: {
  open: boolean;
  initialPath?: string;
  onCancel: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<ServerFolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (p?: string) => {
    setLoading(true);
    setError(null);
    setNewName(null);
    try {
      setListing(await browseServerFolders(p));
    } catch (e: any) {
      setError(e?.message || 'Could not open that folder.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setListing(null);
      load(initialPath);
    }
  }, [open, initialPath, load]);

  const submitNewFolder = async () => {
    if (!listing || !newName?.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      setListing(await createServerFolder(listing.path, newName.trim()));
      setNewName(null);
    } catch (e: any) {
      setCreateError(e?.message || 'Could not create the folder.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Choose backup folder"
      subtitle="Folders on the server computer, where backups are saved."
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button
            disabled={!listing || loading}
            onClick={() => listing && onSelect(listing.path)}
          >
            Use this folder
          </Button>
        </>
      )}
    >
      <div className="space-y-3 text-sm">
        {/* Places */}
        <div className="flex flex-wrap gap-1.5">
          {(listing?.roots || []).map((r) => (
            <button
              key={r.path}
              type="button"
              onClick={() => load(r.path)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-ink hover:bg-surface-2',
                listing?.path === r.path && 'border-accent text-accent',
              )}
            >
              {r.name === 'Server app folder' ? <Home size={13} /> : <HardDrive size={13} />}
              {r.name}
            </button>
          ))}
        </div>

        {/* Current path: breadcrumbs + up */}
        <div className="flex items-center gap-2 rounded-input border border-border bg-surface-2/40 px-2 py-1.5">
          <button
            type="button"
            aria-label="Up one folder"
            disabled={!listing?.parent || loading}
            onClick={() => listing?.parent && load(listing.parent)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 disabled:opacity-40"
          >
            <ArrowUp size={15} />
          </button>
          <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs" aria-label="Current folder">
            {listing && crumbs(listing.path, listing.sep).map((c, i, arr) => (
              <span key={c.path} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight size={12} className="text-ink-muted" />}
                <button
                  type="button"
                  onClick={() => load(c.path)}
                  className={cn(
                    'max-w-[12rem] truncate rounded px-1 py-0.5 hover:bg-surface-2',
                    i === arr.length - 1 ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </nav>
        </div>

        {/* Folder list */}
        <div className="h-72 overflow-y-auto rounded-card border border-border">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-error">
              <AlertTriangle size={18} />
              <p>{error}</p>
            </div>
          ) : loading && !listing ? (
            <p className="p-4 text-ink-muted">Loading folders…</p>
          ) : listing && listing.folders.length === 0 ? (
            <p className="p-4 text-ink-muted">No folders here. Use this folder, or create a new one.</p>
          ) : (
            <ul className={cn('divide-y divide-border', loading && 'opacity-60')}>
              {listing?.folders.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => load(f.path)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink hover:bg-surface-2"
                  >
                    <Folder size={16} className="shrink-0 text-accent" />
                    <span className="truncate">{f.name}</span>
                    <ChevronRight size={14} className="ml-auto shrink-0 text-ink-muted" />
                  </button>
                </li>
              ))}
              {listing?.truncated && (
                <li className="px-3 py-2 text-xs text-ink-muted">Showing the first 1000 folders.</li>
              )}
            </ul>
          )}
        </div>

        {/* New folder */}
        {newName === null ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<FolderPlus size={14} />}
            disabled={!listing || loading || !listing.writable}
            onClick={() => { setNewName(''); setCreateError(null); }}
          >
            New folder
          </Button>
        ) : (
          <form
            className="flex items-start gap-2"
            onSubmit={(e) => { e.preventDefault(); submitNewFolder(); }}
          >
            <Input
              autoFocus
              aria-label="New folder name"
              placeholder="Folder name, e.g. pos-backups"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              error={createError}
              containerClassName="flex-1"
            />
            <Button type="submit" loading={creating} disabled={!newName.trim()}>Create</Button>
            <Button type="button" variant="secondary" onClick={() => setNewName(null)}>Cancel</Button>
          </form>
        )}

        {listing && (
          <div className="rounded-card border border-border bg-surface-2/40 p-3 text-xs">
            <p className="text-ink-muted">Selected folder</p>
            <p className="mt-0.5 break-all font-mono text-ink">{listing.path}</p>
            {!listing.writable && (
              <p className="mt-1.5 flex items-center gap-1 text-warning">
                <AlertTriangle size={12} />
                The server can't write here. Backups to this folder would fail.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
