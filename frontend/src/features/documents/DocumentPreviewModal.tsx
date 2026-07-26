import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { formatBytes, fromNow } from '@/lib/format';
import ReactMarkdown from 'react-markdown';
import { apiUrl } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { DocShape } from '@/types';

/**
 * Inline preview for a document. Renders the file content in a modal:
 *   • PDFs → <iframe> with the auth-protected download URL
 *   • Images → <img>
 *   • Markdown / text / log / JSON / CSV → fetched as text and rendered
 *   • Anything else → metadata + Download / Open in new tab
 *
 * NOTE: <iframe> and <img> don't include the Authorization header, so for
 *       PDFs and images we fetch the bytes as a Blob (with auth) and pass
 *       an object URL to the element. For text we just fetch + read.
 */
export function DocumentPreviewModal({
  doc,
  onClose,
}: {
  doc: DocShape;
  onClose: () => void;
}) {
  const access = useAuthStore((s) => s.access);
  const path = `/api/v1/documents/${doc.id}/download`;
  const url = apiUrl(path);

  const mime = (doc.mimeType || '').toLowerCase();
  const name = doc.name.toLowerCase();
  const isPdf = mime.includes('pdf') || name.endsWith('.pdf');
  const isImage = mime.startsWith('image/');
  const isMarkdown =
    mime.includes('markdown') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    name.endsWith('.mdx');
  const isText =
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('javascript') ||
    mime.includes('csv') ||
    name.endsWith('.txt') ||
    name.endsWith('.log') ||
    name.endsWith('.csv') ||
    name.endsWith('.json') ||
    name.endsWith('.xml') ||
    name.endsWith('.yml') ||
    name.endsWith('.yaml');

  const needsBlob = isPdf || isImage;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsBlob && !isText && !isMarkdown) return;
    setLoading(true);
    setError(null);
    fetch(url, { headers: { Authorization: `Bearer ${access ?? ''}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (needsBlob) {
          const blob = await r.blob();
          return URL.createObjectURL(blob);
        }
        return r.text();
      })
      .then((res) => {
        if (needsBlob) setBlobUrl(res as string);
        else setText(res as string);
      })
      .catch((e) => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false));

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // We intentionally only re-run when the document changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2 truncate">
          <FileText size={18} className="text-slate-400 flex-shrink-0" />
          <span className="truncate">{doc.name}</span>
        </span>
      }
    >
      {/* Metadata bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
        <span>{formatBytes(doc.sizeBytes)}</span>
        <span>{doc.mimeType || 'unknown type'}</span>
        {doc.uploader && <span>by {doc.uploader.fullName}</span>}
        <span>{fromNow(doc.createdAt)}</span>
        {doc.version > 1 && <span>v{doc.version}</span>}
        <span className="ml-auto flex items-center gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
            <ExternalLink size={12} /> Open
          </a>
          <a href={url} download={doc.name} className="btn-secondary text-xs">
            <Download size={12} /> Download
          </a>
        </span>
      </div>

      <div className="min-h-[400px] max-h-[70vh] overflow-auto">
        {loading && (needsBlob || isText || isMarkdown) && (
          <div className="flex items-center gap-2 text-slate-500 text-sm p-4">
            <Loader2 className="animate-spin" size={16} /> Loading preview…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-100 text-sm text-red-700 p-3 rounded">
            Could not load the file: {error}
          </div>
        )}

        {isPdf && blobUrl && (
          <iframe
            src={blobUrl}
            title={doc.name}
            className="w-full h-[70vh] rounded border border-slate-200 bg-slate-50"
          />
        )}

        {isImage && blobUrl && (
          <div className="grid place-items-center bg-slate-50 rounded p-4 min-h-[400px]">
            <img
              src={blobUrl}
              alt={doc.name}
              className="max-w-full max-h-[65vh] object-contain"
            />
          </div>
        )}

        {(isMarkdown || isText) && text !== null && !loading && !error && (
          <div className="bg-slate-50 rounded-lg p-4 text-sm">
            {isMarkdown ? (
              <article className="prose-sm">
                <ReactMarkdown>{text}</ReactMarkdown>
              </article>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-800 leading-relaxed">
                {text}
              </pre>
            )}
          </div>
        )}

        {!needsBlob && !isText && !isMarkdown && (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">📄</div>
            <p className="text-sm text-slate-600">
              Inline preview isn't available for this file type.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {doc.mimeType || 'unknown'} · {formatBytes(doc.sizeBytes)}
            </p>
            <div className="flex justify-center gap-2 mt-4">
              <a href={url} target="_blank" rel="noreferrer" className="btn-secondary text-sm">
                <ExternalLink size={14} /> Open
              </a>
              <a href={url} download={doc.name} className="btn-primary text-sm">
                <Download size={14} /> Download
              </a>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
