import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  ListTree,
  Loader2,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { documentsApi, foldersApi, projectsApi } from '@/api';
import { PageContainer, PageHeader } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { DocumentPreviewModal } from '@/features/documents/DocumentPreviewModal';
import { formatBytes } from '@/lib/format';
import { apiUrl } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { DocShape } from '@/types';

export default function DocumentsPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user)!;
  const [projectId, setProjectId] = useState<string>('');
  const [q, setQ] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [showFolder, setShowFolder] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocShape | null>(null);

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  // Always load folders for the current project scope. When no project is
  // selected we list *all* folders in the tenant so cross-project folders are
  // visible (and so creating one shows up immediately).
  const foldersQ = useQuery({
    queryKey: ['folders', projectId],
    queryFn: () => foldersApi.list({ project: projectId || undefined }),
  });
  const docsQ = useQuery({
    queryKey: ['documents', { projectId, q }],
    queryFn: () =>
      documentsApi.list({
        project: projectId || undefined,
        q: q || undefined,
      }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Deleted');
    },
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => documentsApi.archive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Toggled archive');
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Documents"
        subtitle="Share files across projects and teams"
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowFolder(true)}>
              <FolderPlus size={16} /> New folder
            </button>
            <button className="btn-primary" onClick={() => setShowUpload(true)}>
              <Upload size={16} /> Upload
            </button>
          </>
        }
      />

      <div className="card p-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="label">Project</label>
          <select
            className="input"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          >
            <option value="">All projects</option>
            {projectsQ.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Search</label>
          <div className="relative">
            <Search size={16} className="absolute top-2.5 left-3 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="File name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Unified file explorer — folders + files in the same tree. */}
      <FileExplorer
        folders={foldersQ.data ?? []}
        documents={docsQ.data ?? []}
        projects={projectsQ.data ?? []}
        loading={foldersQ.isLoading || docsQ.isLoading}
        searchQuery={q}
        projectFilterId={projectId || undefined}
        onPreview={setPreviewDoc}
        onDelete={(id) => delMut.mutate(id)}
        onArchive={(id) => archiveMut.mutate(id)}
        canManageFlag={canManage(user.role)}
        currentUserId={user.id}
      />

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          defaultProjectId={projectId}
        />
      )}
      {showFolder && (
        <FolderModal onClose={() => setShowFolder(false)} defaultProjectId={projectId} />
      )}
      {previewDoc && (
        <DocumentPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </PageContainer>
  );
}

// ===========================================================================
// FileExplorer — folders + files in the same tree, Finder / Explorer style.
// ===========================================================================

interface FolderRow {
  id: string;
  tenant_id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
}

interface ProjectMini {
  id: string;
  name: string;
  color: string;
}

/** Pick a sensible lucide icon based on MIME type / filename. */
function FileIcon({ mime, name, className }: { mime?: string | null; name?: string; className?: string }) {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  const cls = clsx('flex-shrink-0', className);
  if (m.startsWith('image/')) return <FileImage size={14} className={cls} />;
  if (m.startsWith('video/')) return <FileVideo size={14} className={cls} />;
  if (m.startsWith('audio/')) return <FileAudio size={14} className={cls} />;
  if (
    m.includes('zip') || m.includes('compressed') || m.includes('tar') ||
    m.includes('gzip') || n.endsWith('.zip') || n.endsWith('.tar') ||
    n.endsWith('.gz') || n.endsWith('.7z') || n.endsWith('.rar')
  ) return <FileArchive size={14} className={cls} />;
  if (
    m.includes('spreadsheet') || m.includes('excel') || n.endsWith('.xls') ||
    n.endsWith('.xlsx') || n.endsWith('.csv')
  ) return <FileSpreadsheet size={14} className={cls} />;
  if (
    m.includes('json') || m.includes('xml') || m.includes('javascript') ||
    m.includes('typescript') || m.includes('html') || n.endsWith('.js') ||
    n.endsWith('.ts') || n.endsWith('.tsx') || n.endsWith('.jsx') ||
    n.endsWith('.py') || n.endsWith('.rb') || n.endsWith('.go') ||
    n.endsWith('.sh') || n.endsWith('.yml') || n.endsWith('.yaml')
  ) return <FileCode size={14} className={cls} />;
  return <FileText size={14} className={cls} />;
}

function FileExplorer({
  folders,
  documents,
  projects,
  loading,
  searchQuery,
  projectFilterId,
  onPreview,
  onDelete,
  onArchive,
  canManageFlag,
  currentUserId,
}: {
  folders: FolderRow[];
  documents: DocShape[];
  projects: ProjectMini[];
  loading: boolean;
  searchQuery: string;
  projectFilterId?: string;
  onPreview: (doc: DocShape) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  canManageFlag: boolean;
  currentUserId: string;
}) {
  // ---- Group data: by project, then by folder ----
  type Group = {
    project: ProjectMini | null; // null = "unfiled" / cross-project
    folders: FolderRow[];        // folders owned by this project (sorted)
    directFiles: DocShape[];     // files at project root (no folder)
  };

  const groups = useMemo<Group[]>(() => {
    const projectById = new Map(projects.map((p) => [p.id, p]));
    // Initialise a group per project + one for cross-project / no-project docs.
    const out: Group[] = projects
      .map((p) => ({ project: p, folders: [], directFiles: [] }))
      .sort((a, b) => a.project.name.localeCompare(b.project.name));
    const unfiled: Group = { project: null, folders: [], directFiles: [] };

    // Bucket folders by project (null bucket = cross-project).
    const folderBuckets = new Map<string | null, FolderRow[]>();
    folderBuckets.set(null, []);
    for (const p of projects) folderBuckets.set(p.id, []);
    for (const f of folders) {
      const key = f.project_id && projectById.has(f.project_id) ? f.project_id : null;
      const bucket = folderBuckets.get(key) ?? folderBuckets.get(null)!;
      bucket.push(f);
    }
    // Sort folders within each bucket.
    for (const bucket of folderBuckets.values()) {
      bucket.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Distribute folders into the right group (or unfiled).
    for (const g of out) {
      g.folders = folderBuckets.get(g.project!.id) ?? [];
    }
    unfiled.folders = folderBuckets.get(null) ?? [];

    // Distribute documents by their project_id (null = unfiled).
    for (const d of documents) {
      if (d.projectId && projectById.has(d.projectId)) {
        const g = out.find((x) => x.project?.id === d.projectId);
        if (g) {
          if (d.folderId) g.folders.push({} as any); // never executed — see below
          else g.directFiles.push(d);
        }
      } else {
        if (!d.folderId) unfiled.directFiles.push(d);
      }
    }
    // Sort files by name.
    for (const g of out) g.directFiles.sort((a, b) => a.name.localeCompare(b.name));
    unfiled.directFiles.sort((a, b) => a.name.localeCompare(b.name));

    // Bucket files by folder_id so we can render them inside their folder.
    const filesByFolder = new Map<string, DocShape[]>();
    for (const d of documents) {
      if (!d.folderId) continue;
      const arr = filesByFolder.get(d.folderId) ?? [];
      arr.push(d);
      filesByFolder.set(d.folderId, arr);
    }
    for (const arr of filesByFolder.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    // Mutate each group: attach its folders' files + remove the stray {} as any above.
    for (const g of [...out, unfiled]) {
      for (const f of g.folders) {
        (f as any)._files = filesByFolder.get(f.id) ?? [];
      }
      // Strip the no-op push (placeholder from the loop above).
      g.folders = g.folders.filter((f) => f.id);
    }

    const result = out.filter((g) => g.folders.length > 0 || g.directFiles.length > 0);
    if (unfiled.folders.length > 0 || unfiled.directFiles.length > 0) result.push(unfiled);
    return result;
  }, [folders, documents, projects]);

  // ---- Filter by toolbar project + search ----
  const filteredGroups = useMemo(() => {
    let g = groups;
    if (projectFilterId) {
      g = g.filter((grp) => grp.project?.id === projectFilterId || grp.project === null);
      // When a project is selected, hide "Unfiled" if it has no items for that project.
      g = g.filter((grp) => grp.project !== null || grp.directFiles.length > 0 || grp.folders.length > 0);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      g = g
        .map((grp) => {
          const folders = grp.folders
            .filter((f) => {
              const files = (f as any)._files as DocShape[];
              return f.name.toLowerCase().includes(q) || files.some((d) => d.name.toLowerCase().includes(q));
            })
            .map((f) => ({ ...f, _files: ((f as any)._files as DocShape[]).filter((d) => d.name.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) }));
          const directFiles = grp.directFiles.filter((d) => d.name.toLowerCase().includes(q));
          return { ...grp, folders, directFiles };
        })
        .filter((grp) => grp.folders.length > 0 || grp.directFiles.length > 0);
    }
    return g;
  }, [groups, projectFilterId, searchQuery]);

  // ---- Expansion state ----
  // Default: all folders expanded, but auto-collapse empty ones when search is empty.
  const allFolderIds = groups.flatMap((g) => g.folders.map((f) => f.id));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(allFolderIds));

  // Count totals for the header.
  const totalFolders = groups.reduce((s, g) => s + g.folders.length, 0);
  const totalFiles = documents.length;

  const hasContent = filteredGroups.some((g) => g.folders.length > 0 || g.directFiles.length > 0);

  const noFilters = !projectFilterId && !searchQuery.trim();
  const filteredCount = filteredGroups.reduce(
    (s, g) => s + g.directFiles.length + g.folders.reduce((s2, f) => s2 + ((f as any)._files as DocShape[]).length, 0),
    0
  );

  return (
    <div className="card overflow-hidden mb-4">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700 inline-flex items-center gap-2 min-w-0">
          <ListTree size={15} className="text-slate-500" />
          {projectFilterId ? (
            projects.find((p) => p.id === projectFilterId)?.name ?? 'Project'
          ) : (
            'All files'
          )}
          <span className="font-mono text-xs text-slate-400">
            {noFilters
              ? `${totalFolders} folder${totalFolders === 1 ? '' : 's'} · ${totalFiles} file${totalFiles === 1 ? '' : 's'}`
              : `${filteredCount} match${filteredCount === 1 ? '' : 'es'}`}
          </span>
        </h2>
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasContent && (
            <>
              <button
                type="button"
                onClick={expandAll}
                disabled={collapsed.size === 0}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                title="Expand all folders"
              >
                <ChevronDown size={12} className="inline -mt-0.5" /> Expand
              </button>
              <button
                type="button"
                onClick={collapseAll}
                disabled={collapsed.size === allFolderIds.length}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded disabled:opacity-30 disabled:hover:bg-transparent"
                title="Collapse all folders"
              >
                <ChevronRight size={12} className="inline -mt-0.5" /> Collapse
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !hasContent ? (
        <div className="px-4 py-10 text-center">
          {noFilters ? (
            <>
              <div className="inline-flex w-10 h-10 rounded-full bg-slate-100 items-center justify-center mb-2 text-slate-400">
                <File size={20} />
              </div>
              <p className="text-sm text-slate-600 font-medium">No files or folders yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Upload your first document or create a folder to start organising your team's files.
              </p>
            </>
          ) : (
            <>
              <div className="inline-flex w-10 h-10 rounded-full bg-slate-100 items-center justify-center mb-2 text-slate-400">
                <Search size={18} />
              </div>
              <p className="text-sm text-slate-600 font-medium">No matches</p>
              <p className="text-xs text-slate-500 mt-1">
                {searchQuery.trim()
                  ? <>Nothing in the current scope matches “{searchQuery.trim()}”.</>
                  : 'This scope has no files yet.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <ul role="tree" className="py-1 text-sm">
          {filteredGroups.map((g) => (
            <ExplorerGroup
              key={g.project?.id ?? '__unfiled__'}
              group={g}
              collapsed={collapsed}
              toggle={toggle}
              onPreview={onPreview}
              onDelete={onDelete}
              onArchive={onArchive}
              canManageFlag={canManageFlag}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ExplorerGroup({
  group,
  collapsed,
  toggle,
  onPreview,
  onDelete,
  onArchive,
  canManageFlag,
  currentUserId,
}: {
  group: {
    project: ProjectMini | null;
    folders: any[];
    directFiles: DocShape[];
  };
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onPreview: (doc: DocShape) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  canManageFlag: boolean;
  currentUserId: string;
}) {
  const isUnfiled = group.project === null;
  const folderCount = group.folders.length;
  const fileCount =
    group.directFiles.length +
    group.folders.reduce((s, f) => s + ((f as any)._files as DocShape[]).length, 0);

  return (
    <li role="treeitem">
      {/* Group header */}
      <div
        className={clsx(
          'flex items-center gap-2 pl-3 pr-4 py-1.5 border-t border-slate-100 bg-slate-50/40',
          isUnfiled && 'border-t-0'
        )}
      >
        {isUnfiled ? (
          <Inbox size={13} className="text-slate-400 flex-shrink-0" />
        ) : (
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: group.project!.color }}
          />
        )}
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 truncate">
          {isUnfiled ? 'Unfiled' : group.project!.name}
        </span>
        <span className="font-mono text-[10px] text-slate-400 ml-1 normal-case tracking-normal">
          {folderCount > 0 && (
            <span>{folderCount} folder{folderCount === 1 ? '' : 's'}</span>
          )}
          {folderCount > 0 && fileCount > 0 && <span> · </span>}
          {fileCount > 0 && <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>}
        </span>
      </div>

      {/* Direct files at project root */}
      {group.directFiles.length > 0 && (
        <ul role="group">
          {group.directFiles.map((d) => (
            <FileRow
              key={d.id}
              doc={d}
              indent={1}
              onPreview={onPreview}
              onDelete={onDelete}
              onArchive={onArchive}
              canManageFlag={canManageFlag}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}

      {/* Folders */}
      {group.folders.length > 0 && (
        <ul role="group">
          {group.folders.map((f) => {
            const files = (f as any)._files as DocShape[];
            const isOpen = !collapsed.has(f.id);
            return (
              <FolderNode
                key={f.id}
                folder={f}
                files={files}
                isOpen={isOpen}
                onToggle={() => toggle(f.id)}
                onPreview={onPreview}
                onDelete={onDelete}
                onArchive={onArchive}
                canManageFlag={canManageFlag}
                currentUserId={currentUserId}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

function FolderNode({
  folder,
  files,
  isOpen,
  onToggle,
  onPreview,
  onDelete,
  onArchive,
  canManageFlag,
  currentUserId,
}: {
  folder: FolderRow;
  files: DocShape[];
  isOpen: boolean;
  onToggle: () => void;
  onPreview: (doc: DocShape) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  canManageFlag: boolean;
  currentUserId: string;
}) {
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={onToggle}
        title={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
        className={clsx(
          'w-full flex items-center gap-1.5 pl-5 pr-3 py-1.5 text-left text-sm transition',
          'hover:bg-slate-50 text-slate-700'
        )}
      >
        <span className="text-slate-400 w-3 inline-flex justify-center">
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        {isOpen ? (
          <FolderOpen size={14} className="text-amber-500 flex-shrink-0" />
        ) : (
          <Folder size={14} className="text-amber-500/80 group-hover:text-amber-600 flex-shrink-0" />
        )}
        <span className="truncate flex-1">{folder.name}</span>
        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
          {files.length}
        </span>
      </button>
      {isOpen && (
        <ul role="group">
          {files.length === 0 ? (
            <li>
              <div className="pl-12 pr-3 py-1 text-xs text-slate-400 italic">Empty folder</div>
            </li>
          ) : (
            files.map((d) => (
              <FileRow
                key={d.id}
                doc={d}
                indent={2}
                onPreview={onPreview}
                onDelete={onDelete}
                onArchive={onArchive}
                canManageFlag={canManageFlag}
                currentUserId={currentUserId}
              />
            ))
          )}
        </ul>
      )}
    </li>
  );
}

function FileRow({
  doc,
  indent,
  onPreview,
  onDelete,
  onArchive,
  canManageFlag,
  currentUserId,
}: {
  doc: DocShape;
  indent: number;
  onPreview: (doc: DocShape) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  canManageFlag: boolean;
  currentUserId: string;
}) {
  const canPreview = isPreviewable(doc);
  const isOwner = doc.uploadedBy === currentUserId;
  const canManage = canManageFlag || isOwner;
  const paddingLeft = indent === 1 ? 'pl-9' : 'pl-14';

  return (
    <li role="treeitem">
      <div
        className={clsx(
          'group flex items-center gap-2 pr-3 py-1 text-sm transition',
          paddingLeft,
          'hover:bg-slate-50'
        )}
      >
        <FileIcon mime={doc.mimeType} name={doc.name} className="text-slate-500" />
        {canPreview ? (
          <button
            type="button"
            onClick={() => onPreview(doc)}
            title={`Preview ${doc.name}`}
            className="font-medium text-slate-800 hover:text-brand-700 hover:underline text-left truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 rounded min-w-0 flex-1"
          >
            {doc.name}
          </button>
        ) : (
          <a
            href={apiUrl(`/api/v1/documents/${doc.id}/download`)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-800 hover:text-brand-700 hover:underline truncate min-w-0 flex-1"
            title={`Open ${doc.name}`}
          >
            {doc.name}
          </a>
        )}
        {doc.isArchived && <span className="badge-yellow text-[10px]">Archived</span>}
        {doc.version > 1 && <span className="text-[10px] text-slate-400">v{doc.version}</span>}

        <span className="text-xs text-slate-400 font-mono hidden sm:inline-block ml-auto pl-2">
          {formatBytes(doc.sizeBytes)}
        </span>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
          {canPreview && (
            <button
              type="button"
              onClick={() => onPreview(doc)}
              title="Preview"
              className="p-1 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"
            >
              <Eye size={13} />
            </button>
          )}
          <a
            href={apiUrl(`/api/v1/documents/${doc.id}/download`)}
            download={doc.name}
            title="Download"
            className="p-1 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50"
          >
            <Download size={13} />
          </a>
          {canManage && (
            <button
              type="button"
              onClick={() => onArchive(doc.id)}
              title={doc.isArchived ? 'Unarchive' : 'Archive'}
              className="p-1 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50"
            >
              <Archive size={13} />
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Delete "${doc.name}"? This cannot be undone.`)) onDelete(doc.id);
              }}
              title="Delete"
              className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

const uploadSchema = z.object({
  name: z.string().optional(),
  projectId: z.string().optional(),
  folderId: z.string().optional(),
  visibility: z.enum(['private', 'team', 'project']).default('team'),
});

function UploadModal({
  onClose,
  defaultProjectId,
}: {
  onClose: () => void;
  defaultProjectId?: string;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const form = useForm({
    resolver: zodResolver(uploadSchema),
    defaultValues: { name: '', projectId: defaultProjectId ?? '', folderId: '', visibility: 'team' as const },
  });
  const { register, handleSubmit, watch } = form;
  const projectId = watch('projectId');

  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const foldersQ = useQuery({
    queryKey: ['folders', projectId],
    queryFn: () => foldersApi.list({ project: projectId || undefined }),
    enabled: !!projectId,
  });

  async function onSubmit(values: any) {
    if (!file) { toast.error('Pick a file'); return; }
    const fd = new FormData();
    fd.append('file', file);
    if (values.name) fd.append('name', values.name);
    if (values.projectId) fd.append('projectId', values.projectId);
    else if (defaultProjectId) fd.append('projectId', defaultProjectId);
    if (values.folderId) fd.append('folderId', values.folderId);
    if (values.visibility) fd.append('visibility', values.visibility);
    try {
      await documentsApi.upload(fd);
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Uploaded');
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload failed');
    }
  }

  return (
    <Modal open onClose={onClose} title="Upload a document">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="label">File</label>
          <input
            type="file"
            className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-slate-500 mt-1">Max 25 MB.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Display name (optional)</label>
            <input className="input" {...register('name')} placeholder="defaults to file name" />
          </div>
          <div>
            <label className="label">Visibility</label>
            <select className="input" {...register('visibility')}>
              <option value="private">Private (only me)</option>
              <option value="team">Team (whole tenant)</option>
              <option value="project">Project members</option>
            </select>
          </div>
          <div>
            <label className="label">Project (optional)</label>
            <select className="input" {...register('projectId')} defaultValue={defaultProjectId ?? ''}>
              <option value="">—</option>
              {projectsQ.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Folder (optional)</label>
            <select className="input" {...register('folderId')} disabled={!projectId && !defaultProjectId}>
              <option value="">—</option>
              {(foldersQ.data ?? []).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">Upload</button>
        </div>
      </form>
    </Modal>
  );
}

const folderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Folder name is required')
    .max(200, 'Folder name is too long'),
  projectId: z.string().optional(),
});

type FolderFormValues = z.infer<typeof folderSchema>;

function FolderModal({
  onClose,
  defaultProjectId,
}: {
  onClose: () => void;
  defaultProjectId?: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FolderFormValues>({
    resolver: zodResolver(folderSchema),
    defaultValues: { name: '', projectId: defaultProjectId ?? '' },
    mode: 'onSubmit',
    shouldUseNativeValidation: false,
  });

  const projectId = watch('projectId');

  // Re-fetch folders whenever the user changes the project scope within the
  // modal. We deliberately use a separate query cache namespace (`folders-modal`)
  // so we never collide with the page-level folders query — otherwise an empty
  // project picker would inherit the page's "all folders" cache and the user
  // would see every folder in the tenant instead of just the chosen project's.
  const foldersQ = useQuery({
    queryKey: ['folders-modal', projectId || ''],
    queryFn: () => foldersApi.list({ project: projectId || undefined }),
  });

  // Auto-focus the name field when the modal opens.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const createMut = useMutation({
    mutationFn: (data: FolderFormValues) =>
      foldersApi.create({ name: data.name, projectId: data.projectId || null }),
    onSuccess: () => {
      // Invalidate BOTH the page-level folders query and the modal's own
      // scoped query so the explorer and the modal preview both refresh.
      qc.invalidateQueries({ queryKey: ['folders'] });
      qc.invalidateQueries({ queryKey: ['folders-modal'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Folder created');
      onClose();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? 'Could not create folder');
    },
  });

  function onSubmit(values: FolderFormValues) {
    createMut.mutate(values);
  }

  // Sync the form's projectId when the page filter changes (modal open w/ a default).
  useEffect(() => {
    setValue('projectId', defaultProjectId ?? '');
  }, [defaultProjectId, setValue]);

  return (
    <Modal open onClose={onClose} title="Create a folder">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="folder-name" className="label">
            Folder name
          </label>
          <input
            id="folder-name"
            type="text"
            autoComplete="off"
            placeholder="e.g. Drawings, Permits, Daily reports"
            className="input"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'folder-name-err' : undefined}
            {...register('name')}
            ref={(el) => {
              register('name').ref(el);
              inputRef.current = el;
            }}
          />
          {errors.name && (
            <p id="folder-name-err" className="mt-1 text-xs text-red-600">
              {errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="folder-project" className="label">
            Project (optional)
          </label>
          <select
            id="folder-project"
            className="input"
            {...register('projectId')}
            aria-invalid={!!errors.projectId}
          >
            <option value="">— Cross-project —</option>
            {projectsQ.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            A folder can live at the project level (only those files) or be shared across
            the whole team (leave empty).
          </p>
        </div>

        {projectId && foldersQ.data && foldersQ.data.length > 0 && (
          <div>
            <label className="label">Existing folders in this project</label>
            <ul className="text-xs text-slate-600 space-y-1 max-h-32 overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50">
              {(foldersQ.data ?? []).map((f) => (
                <li key={f.id} className="flex items-center gap-1.5">
                  <Folder size={12} className="text-slate-400" />
                  {f.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSubmitting || createMut.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting || createMut.isPending}
          >
            {createMut.isPending ? <Loader2 className="animate-spin" size={16} /> : null}
            Create folder
          </button>
        </div>
      </form>
    </Modal>
  );
}

function isPreviewable(doc: DocShape): boolean {
  const mime = (doc.mimeType || '').toLowerCase();
  const name = doc.name.toLowerCase();
  return (
    mime.includes('pdf') ||
    name.endsWith('.pdf') ||
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    mime.includes('markdown') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.txt') ||
    name.endsWith('.log') ||
    name.endsWith('.csv') ||
    name.endsWith('.json') ||
    name.endsWith('.xml') ||
    name.endsWith('.yml') ||
    name.endsWith('.yaml')
  );
}
