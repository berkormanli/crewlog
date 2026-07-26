import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { db } from '../../db/index.js';
import { storage } from '../../lib/storage.js';
import { config } from '../../config.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { canManage } from '../../lib/jwt.js';
import { recordAudit } from '../../lib/audit.js';

const VISIBILITIES = ['private', 'team', 'project'] as const;

const folderCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Folder name is required')
    .max(200, 'Folder name is too long'),
  projectId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
});

const folderUpdateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Folder name is required')
    .max(200, 'Folder name is too long'),
});

const docUpdateSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
});

function shapeDoc(row: Record<string, any>, uploader?: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    folderId: row.folder_id,
    name: row.name,
    description: row.description,
    uploadedBy: row.uploaded_by,
    uploader: uploader
      ? { id: uploader.id, fullName: uploader.full_name, email: uploader.email, avatarUrl: uploader.avatar_url }
      : null,
    filePath: row.file_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    version: row.version,
    parentDocumentId: row.parent_document_id,
    visibility: row.visibility,
    isArchived: row.is_archived,
    createdAt: row.created_at,
  };
}

/**
 * Returns true if `user` is allowed to read `doc`.
 */
async function canReadDoc(
  doc: { tenant_id: string; project_id: string | null; uploaded_by: string | null; visibility: string },
  user: { sub: string; tid: string; role: string }
): Promise<boolean> {
  if (doc.tenant_id !== user.tid) return false;
  if (canManage(user.role as any)) return true;
  if (doc.visibility === 'team') return true;
  if (doc.visibility === 'private') return doc.uploaded_by === user.sub;
  if (doc.visibility === 'project' && doc.project_id) {
    const member = await db('project_members')
      .where({ project_id: doc.project_id, user_id: user.sub })
      .first();
    return !!member;
  }
  return false;
}

export async function folderRoutes(app: FastifyInstance) {
  app.get('/folders', async (req) => {
    const q = req.query as { project?: string; parent?: string };
    const qb = db('folders').where({ tenant_id: req.user.tid });
    if (q.project) qb.where('project_id', q.project);
    if (q.parent) qb.where('parent_id', q.parent);
    return qb.orderBy('name', 'asc');
  });

  // Anyone in the tenant can create a folder — folders are organizational,
  // not privileged. The creator becomes the owner and can rename/delete it,
  // and managers+ can manage anything.
  app.post('/folders', async (req) => {
    const parsed = folderCreateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid folder', parsed.error.flatten());
    const [row] = await db('folders')
      .insert({
        tenant_id: req.user.tid,
        name: parsed.data.name,
        project_id: parsed.data.projectId ?? null,
        parent_id: parsed.data.parentId ?? null,
        created_by: req.user.sub,
      })
      .returning('*');
    await recordAudit(req, 'create', 'folder', row.id, {
      after: {
        name: row.name,
        projectId: row.project_id,
        parentId: row.parent_id,
      },
    });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/folders/:id', async (req) => {
    const parsed = folderUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update', parsed.error.flatten());
    const existing = await db('folders').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Folder');
    // Only the creator or a manager+ can rename.
    if (existing.created_by !== req.user.sub && !canManage(req.user.role)) {
      throw forbidden('Only the creator or a manager can rename this folder');
    }
    await db('folders').where({ id: req.params.id }).update({ name: parsed.data.name });
    const updated = await db('folders').where({ id: req.params.id }).first();
    if (existing.name !== updated.name) {
      await recordAudit(req, 'update', 'folder', updated.id, {
        diff: { name: { from: existing.name, to: updated.name } },
        projectId: updated.project_id,
      });
    }
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/folders/:id', async (req) => {
    const existing = await db('folders').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!existing) throw notFound('Folder');
    // Only the creator or a manager+ can delete.
    if (existing.created_by !== req.user.sub && !canManage(req.user.role)) {
      throw forbidden('Only the creator or a manager can delete this folder');
    }
    // Documents inside this folder get un-foldered (folder_id -> null) so they aren't lost.
    await db('documents').where({ folder_id: req.params.id }).update({ folder_id: null });
    await db('folders').where({ id: req.params.id }).delete();
    await recordAudit(req, 'delete', 'folder', req.params.id, {
      before: { name: existing.name, projectId: existing.project_id },
    });
    return { ok: true };
  });
}

export async function documentRoutes(app: FastifyInstance) {
  // List documents (filtered)
  app.get('/documents', async (req) => {
    const q = req.query as Record<string, string>;
    let qb = db('documents')
      .where({ tenant_id: req.user.tid })
      .where('is_archived', q.archived === 'true' ? true : false)
      .whereNull('deleted_at');

    if (q.project) qb = qb.where('project_id', q.project);
    if (q.folder === 'null' || q.folder === 'none') {
      qb = qb.whereNull('folder_id');
    } else if (q.folder) {
      qb = qb.where('folder_id', q.folder);
    }
    if (q.uploader) qb = qb.where('uploaded_by', q.uploader);
    if (q.q) {
      const like = `%${q.q.toLowerCase()}%`;
      qb = qb.andWhere(function () {
        this.whereRaw('LOWER(name) LIKE ?', [like]).orWhereRaw('LOWER(description) LIKE ?', [like]);
      });
    }

    // Worker constraint: limit to readable docs
    if (req.user.role === 'worker') {
      qb = qb.andWhere(function () {
        this.where('uploaded_by', req.user.sub)
          .orWhere('visibility', 'team')
          .orWhere(function () {
            this.where('visibility', 'project').whereNotNull('project_id');
          });
      });
    }

    const rows = await qb.orderBy('created_at', 'desc');
    if (!rows.length) return [];

    // Filter access on project (need project_members) for workers
    const uploaderIds = Array.from(new Set(rows.map((r: any) => r.uploaded_by).filter(Boolean) as string[]));
    const uploaders = uploaderIds.length
      ? await db('users').whereIn('id', uploaderIds).select('id', 'full_name', 'email', 'avatar_url')
      : [];
    const uMap = new Map(uploaders.map((u) => [u.id, u]));

    // For project visibility docs, also check membership
    const out: any[] = [];
    for (const r of rows) {
      const ok = await canReadDoc(r as any, req.user);
      if (ok) out.push(shapeDoc(r, uMap.get(r.uploaded_by)));
    }
    return out;
  });

  // Upload (multipart)
  app.post('/documents', async (req, reply) => {
    if (!req.isMultipart()) throw badRequest('multipart_required', 'Expected multipart/form-data');

    let projectId: string | null = null;
    let folderId: string | null = null;
    let description: string | null = null;
    let visibility: 'private' | 'team' | 'project' = 'team';
    const fileRef: { current: { buf: Buffer; name: string; mime: string } | null } = { current: null };
    let parentDocumentId: string | null = null;
    let name: string | null = null;

    try {
      for await (const part of (req as any).parts()) {
        if (part.type === 'file' && part.fieldname === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) chunks.push(chunk as Buffer);
          const buf = Buffer.concat(chunks);
          fileRef.current = { buf, name: part.filename ?? 'upload.bin', mime: part.mimetype ?? 'application/octet-stream' };
        } else if (part.type === 'field') {
          const v = part.value as string;
          if (part.fieldname === 'projectId') projectId = v || null;
          else if (part.fieldname === 'folderId') folderId = v || null;
          else if (part.fieldname === 'description') description = v || null;
          else if (part.fieldname === 'visibility') visibility = (v as any) || 'team';
          else if (part.fieldname === 'parentDocumentId') parentDocumentId = v || null;
          else if (part.fieldname === 'name') name = v || null;
        }
      }
    } catch (err: any) {
      throw badRequest('upload_failed', 'Failed to parse multipart', err?.message ?? String(err));
    }

    if (!fileRef.current) throw badRequest('file_required', 'A file is required');
    const file = fileRef.current;
    if (file.buf.length > config.uploads.maxBytes) {
      throw badRequest('file_too_large', `File exceeds ${config.uploads.maxBytes} bytes`);
    }

    // Validate project/folder if provided
    if (projectId) {
      const proj = await db('projects').where({ id: projectId, tenant_id: req.user.tid }).first();
      if (!proj) throw notFound('Project');
    }
    if (folderId) {
      const folder = await db('folders').where({ id: folderId, tenant_id: req.user.tid }).first();
      if (!folder) throw notFound('Folder');
    }

    const stored = await storage.save(file.buf, file.name);

    const [row] = await db('documents')
      .insert({
        tenant_id: req.user.tid,
        project_id: projectId,
        folder_id: folderId,
        name: name ?? file.name,
        description,
        uploaded_by: req.user.sub,
        file_path: stored.relPath,
        mime_type: file.mime,
        size_bytes: file.buf.length,
        version: parentDocumentId ? 2 : 1,
        parent_document_id: parentDocumentId,
        visibility,
      })
      .returning('*');

    await recordAudit(req, 'create', 'document', row.id, {
      after: {
        name: row.name,
        projectId: row.project_id,
        folderId: row.folder_id,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        version: row.version,
        visibility: row.visibility,
      },
    });

    return shapeDoc(row);
  });

  app.get<{ Params: { id: string } }>('/documents/:id', async (req) => {
    const row = await db('documents')
      .where({ id: req.params.id, tenant_id: req.user.tid })
      .whereNull('deleted_at')
      .first();
    if (!row) throw notFound('Document');
    if (!(await canReadDoc(row as any, req.user))) throw forbidden('No access to this document');
    const uploader = row.uploaded_by ? await db('users').where({ id: row.uploaded_by }).first() : null;
    return shapeDoc(row, uploader ?? undefined);
  });

  app.get<{ Params: { id: string } }>('/documents/:id/download', async (req, reply) => {
    const row = await db('documents')
      .where({ id: req.params.id, tenant_id: req.user.tid })
      .whereNull('deleted_at')
      .first();
    if (!row) throw notFound('Document');
    if (!(await canReadDoc(row as any, req.user))) throw forbidden('No access to this document');

    const absPath = storage.resolve(row.file_path);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat) throw notFound('File');

    reply.header('Content-Type', row.mime_type);
    reply.header(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(row.name).replace(/['"]/g, '')}"`
    );
    reply.header('Content-Length', stat.size);
    return reply.send(createReadStream(absPath));
  });

  app.get<{ Params: { id: string } }>('/documents/:id/versions', async (req) => {
    const row = await db('documents').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Document');
    if (!(await canReadDoc(row as any, req.user))) throw forbidden('No access to this document');

    // Root doc id is the first version (no parent_document_id chain)
    const rootId = row.parent_document_id ?? row.id;
    const versions = await db('documents')
      .where(function () {
        this.where('id', rootId).orWhere('parent_document_id', rootId);
      })
      .orderBy('version', 'asc')
      .select('id', 'version', 'name', 'size_bytes', 'mime_type', 'created_at');

    return versions;
  });

  app.patch<{ Params: { id: string } }>('/documents/:id', async (req) => {
    const row = await db('documents').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Document');
    if (req.user.role === 'worker' && row.uploaded_by !== req.user.sub) throw forbidden();
    const parsed = docUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('invalid_request', 'Invalid update', parsed.error.flatten());

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.folderId !== undefined) patch.folder_id = parsed.data.folderId;
    if (parsed.data.visibility !== undefined) patch.visibility = parsed.data.visibility;

    if (Object.keys(patch).length) {
      await db('documents').where({ id: req.params.id }).update(patch);
    }
    const updated = await db('documents').where({ id: req.params.id }).first();
    const tracked = ['name', 'description', 'visibility'];
    const diff: Record<string, { from: any; to: any }> = {};
    for (const f of tracked) {
      const a = (row as any)[f === 'name' ? 'name' : f];
      const b = (updated as any)[f === 'name' ? 'name' : f];
      if (a !== b) diff[f] = { from: a, to: b };
    }
    if (parsed.data.folderId !== undefined && row.folder_id !== updated.folder_id) {
      diff.folderId = { from: row.folder_id, to: updated.folder_id };
    }
    if (Object.keys(diff).length > 0) {
      await recordAudit(req, 'update', 'document', row.id, { diff });
    }
    return shapeDoc(updated);
  });

  app.post<{ Params: { id: string } }>('/documents/:id/archive', async (req) => {
    const row = await db('documents').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Document');
    const isOwner = row.uploaded_by === req.user.sub;
    if (!canManage(req.user.role) && !isOwner) throw forbidden();
    const next = !row.is_archived;
    await db('documents').where({ id: req.params.id }).update({ is_archived: next });
    await recordAudit(req, next ? 'archive' : 'unarchive', 'document', row.id, {
      name: row.name,
    });
    return { isArchived: next };
  });

  app.delete<{ Params: { id: string } }>('/documents/:id', async (req) => {
    const row = await db('documents').where({ id: req.params.id, tenant_id: req.user.tid }).first();
    if (!row) throw notFound('Document');
    if (!canManage(req.user.role) && row.uploaded_by !== req.user.sub) throw forbidden();
    await db('documents').where({ id: req.params.id }).update({ deleted_at: db.fn.now() });
    await recordAudit(req, 'delete', 'document', row.id, {
      before: {
        name: row.name,
        projectId: row.project_id,
        folderId: row.folder_id,
      },
    });
    return { ok: true };
  });
}

// Silence unused
void path;
