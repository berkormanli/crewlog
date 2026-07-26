import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { tasksApi, projectsApi, usersApi } from '@/api';
import { Spinner } from '@/components/Spinner';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth';
import { canManage } from '@/lib/rbac';
import { PRIORITY_LABELS, STATUS_LABELS, DIFFICULTY_LABELS } from '@/lib/ui';

const schema = z.object({
  projectId: z.string().uuid('Pick a project'),
  title: z.string().min(1, 'Title required').max(300),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().uuid().optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'waiting', 'review', 'qa', 'done']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert']),
  dueDate: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export function TaskCreateModal({
  onClose,
  defaultProjectId,
  onCreated,
}: {
  onClose: () => void;
  defaultProjectId?: string;
  onCreated?: (taskId: string) => void;
}) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user)!;
  const projectsQ = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
  const usersQ = useQuery({ queryKey: ['users-list'], queryFn: usersApi.list });

  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      projectId: defaultProjectId ?? '',
      title: '',
      description: '',
      assigneeId: user.role === 'worker' ? user.id : undefined,
      status: 'backlog',
      priority: 'medium',
      difficulty: 'medium',
    },
  });

  const mut = useMutation({
    mutationFn: (data: FormValues) =>
      tasksApi.create({
        projectId: data.projectId,
        title: data.title,
        description: data.description || undefined,
        assigneeId: data.assigneeId || null,
        status: data.status,
        priority: data.priority,
        difficulty: data.difficulty,
        dueDate: data.dueDate || undefined,
      } as any),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Task created');
      onCreated?.(task.id);
      onClose();
    },
  });

  return (
    <Modal open onClose={onClose} title="Create a new task">
      <form onSubmit={handleSubmit((d) => mut.mutate(d))} className="space-y-4">
        <div>
          <label className="label">Title</label>
          <input className="input" {...register('title')} placeholder="e.g. Inspect rebar before pour" />
          {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Project</label>
            <select className="input" {...register('projectId')}>
              <option value="">Select…</option>
              {projectsQ.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {errors.projectId && <p className="text-xs text-red-600 mt-1">{errors.projectId.message}</p>}
          </div>
          {canManage(user.role) && (
            <div>
              <label className="label">Assignee</label>
              <select className="input" {...register('assigneeId')}>
                <option value="">Unassigned</option>
                {usersQ.data?.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label className="label">Description</label>
          <textarea rows={3} className="input" {...register('description')} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Status</label>
            <select className="input" {...register('status')}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Due date</label>
            <input type="date" className="input" {...register('dueDate')} />
          </div>
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
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>
            {mut.isPending ? <Spinner /> : 'Create task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
