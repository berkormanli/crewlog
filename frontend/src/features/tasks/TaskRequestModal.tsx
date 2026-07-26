import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { projectsApi, taskRequestsApi } from '@/api';
import { PRIORITY_LABELS, DIFFICULTY_LABELS } from '@/lib/ui';
import type { TaskRequest } from '@/types';

const schema = z.object({
  projectId: z.string().uuid().optional().or(z.literal('')),
  title: z.string().min(1, 'Title required').max(300),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']).default('medium'),
  dueDate: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function TaskRequestModal({
  onClose,
  request,
}: {
  onClose: () => void;
  /**
   * If provided, edit that existing request. Otherwise create a new one.
   * Note: managers also use this for editing an existing pending request.
   */
  request?: TaskRequest;
}) {
  const qc = useQueryClient();
  const isEdit = Boolean(request);
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: request?.projectId ?? '',
      title: request?.title ?? '',
      description: request?.description ?? '',
      priority: request?.priority ?? 'medium',
      difficulty: request?.difficulty ?? 'medium',
      dueDate: request?.dueDate ?? '',
    },
  });

  useEffect(() => {
    if (request) {
      reset({
        projectId: request.projectId ?? '',
        title: request.title,
        description: request.description ?? '',
        priority: request.priority,
        difficulty: request.difficulty,
        dueDate: request.dueDate ?? '',
      });
    }
  }, [request, reset]);

  const mut = useMutation({
    mutationFn: (data: FormValues) => {
      const payload = {
        projectId: data.projectId || undefined,
        title: data.title,
        description: data.description || undefined,
        priority: data.priority,
        difficulty: data.difficulty,
        dueDate: data.dueDate || undefined,
      };
      return isEdit
        ? taskRequestsApi.update(request!.id, payload as any)
        : taskRequestsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-requests'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(isEdit ? 'Request updated' : 'Request submitted');
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit task request' : 'Request a new task'}
      size="lg"
    >
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
        <div>
          <label className="label">Title *</label>
          <input className="input" {...register('title')} placeholder="e.g. Coordinate crane delivery window" />
          {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title.message}</p>}
        </div>
        <div>
          <label className="label">Project</label>
          <select className="input" {...register('projectId')}>
            <option value="">— Not sure yet —</option>
            {projectsQ.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500 mt-1">
            Pick the project this task is for, or leave blank if you're not sure — a manager will assign it.
          </p>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            rows={4}
            className="input"
            {...register('description')}
            placeholder="What needs to happen, why, and any links or dependencies."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Priority</label>
            <select className="input" {...register('priority')}>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Difficulty</label>
            <select className="input" {...register('difficulty')}>
              {Object.entries(DIFFICULTY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Due date</label>
            <input type="date" className="input" {...register('dueDate')} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? <Spinner /> : isEdit ? 'Save changes' : 'Submit request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}