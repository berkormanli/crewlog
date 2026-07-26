import type { FastifyInstance } from 'fastify';
import { db } from '../../db/index.js';
import { canManage } from '../../lib/jwt.js';
import { isoDate, todayIso, daysAgoIso } from '../../lib/dates.js';
import { describeEntity as describeAuditEntity } from '../audit/routes.js';

// Shape a task row the same way tasks/routes.ts does.
function shapeTask(row: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    status: row.status,
    priority: row.priority,
    difficulty: row.difficulty,
    dueDate: row.due_date,
    actualHours: Number(row.actual_hours),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  // Today's hours, open tasks, recent logs (returns properly-cased nested shape)
  app.get('/dashboard/me', async (req) => {
    const today = todayIso();

    const [todayAgg, openTasksAgg, recentLogRows, upcomingTaskRows] = await Promise.all([
      db('work_logs')
        .where({ tenant_id: req.user.tid, worker_id: req.user.sub, date: today })
        .sum('hours as total')
        .first(),
      db('tasks')
        .where({ tenant_id: req.user.tid, assignee_id: req.user.sub })
        .whereNot('status', 'done')
        .count('id as c')
        .first(),
      db('work_logs')
        .where({ tenant_id: req.user.tid, worker_id: req.user.sub })
        .orderBy('created_at', 'desc')
        .limit(5),
      db('tasks')
        .where({ tenant_id: req.user.tid, assignee_id: req.user.sub })
        .whereNot('status', 'done')
        .orderBy('due_date', 'asc')
        .limit(5)
        .whereNotNull('due_date'),
    ]);

    // Decorate recent logs with project + task + customer
    const projectIds = Array.from(new Set(recentLogRows.map((r: any) => r.project_id).filter(Boolean) as string[]));
    const taskIds = Array.from(
      new Set(recentLogRows.map((r: any) => r.task_id).filter(Boolean) as string[])
    );
    const customerIds = Array.from(new Set(recentLogRows.map((r: any) => r.customer_id).filter(Boolean) as string[]));
    const [projects, tasks, customers] = await Promise.all([
      projectIds.length
        ? db('projects').whereIn('id', projectIds).select('id', 'name', 'code', 'color')
        : Promise.resolve([]),
      taskIds.length
        ? db('tasks').whereIn('id', taskIds).select('id', 'title')
        : Promise.resolve([]),
      customerIds.length
        ? db('customers').whereIn('id', customerIds).select('id', 'name', 'code')
        : Promise.resolve([]),
    ]);
    const projectMap = new Map(projects.map((p: any) => [p.id, p]));
    const taskMap = new Map(tasks.map((t: any) => [t.id, t]));
    const customerMap = new Map(customers.map((c: any) => [c.id, c]));

    const recentLogs = recentLogRows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      workerId: r.worker_id,
      date: isoDate(r.date),
      projectId: r.project_id,
      customerId: r.customer_id,
      taskId: r.task_id,
      hours: r.hours != null ? Number(r.hours) : null,
      startTime: typeof r.start_time === 'string' ? r.start_time.slice(0, 5) : null,
      endTime: typeof r.end_time === 'string' ? r.end_time.slice(0, 5) : null,
      module: r.module ?? null,
      moduleOther: r.module_other ?? null,
      activityType: r.activity_type ?? null,
      activityTypeOther: r.activity_type_other ?? null,
      location: r.location ?? null,
      locationOther: r.location_other ?? null,
      description: r.description,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      project: r.project_id && projectMap.get(r.project_id)
        ? {
            id: r.project_id,
            name: projectMap.get(r.project_id)!.name,
            code: projectMap.get(r.project_id)!.code,
            color: projectMap.get(r.project_id)!.color,
          }
        : null,
      customer: r.customer_id && customerMap.get(r.customer_id)
        ? {
            id: r.customer_id,
            name: customerMap.get(r.customer_id)!.name,
            code: customerMap.get(r.customer_id)!.code,
          }
        : null,
      task: r.task_id
        ? { id: r.task_id, title: taskMap.get(r.task_id)?.title ?? null }
        : null,
    }));

    return {
      todayHours: Number(todayAgg?.total ?? 0),
      openTaskCount: Number(openTasksAgg?.c ?? 0),
      upcomingTasks: upcomingTaskRows.map(shapeTask),
      recentLogs,
    };
  });

  // Team hours this week, overdue tasks, top projects
  app.get('/dashboard/manager', async (req) => {
    if (!canManage(req.user.role)) return { hidden: true };

    const today = todayIso();
    // Sunday-start week
    const start = daysAgoIso(new Date().getDay());

    const [teamThisWeek, overdueTasks, topProjects, recentActivity] = await Promise.all([
      db('work_logs').where('tenant_id', req.user.tid).where('date', '>=', start).sum('hours as total').first(),
      db('tasks')
        .where({ tenant_id: req.user.tid })
        .whereNot('status', 'done')
        .whereNotNull('due_date')
        .where('due_date', '<', today)
        .count('id as c')
        .first(),
      db('work_logs')
        .leftJoin('projects as p', 'p.id', 'work_logs.project_id')
        .where('work_logs.tenant_id', req.user.tid)
        .select('p.id', 'p.name', 'p.color', 'p.code')
        .sum('work_logs.hours as total')
        .groupBy('p.id', 'p.name', 'p.color', 'p.code')
        .orderBy('total', 'desc')
        .limit(5),
      db('audit_log')
        .leftJoin('users as u', 'u.id', 'audit_log.actor_id')
        .where('audit_log.tenant_id', req.user.tid)
        .orderBy('audit_log.created_at', 'desc')
        .limit(10)
        .select(
          'audit_log.id',
          'audit_log.actor_id',
          'audit_log.action',
          'audit_log.entity_type',
          'audit_log.entity_id',
          'audit_log.payload',
          'audit_log.created_at',
          'u.full_name as actor_name',
          'u.email as actor_email',
          'u.role as actor_role',
          'u.avatar_url as actor_avatar'
        ),
    ]);

    const recentActivityDecorated = await Promise.all(
      recentActivity.map(async (a: any) => {
        const entity = await describeAuditEntity(a.entity_type, a.entity_id, req.user.tid);
        let payload: any = a.payload;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = {};
          }
        }
        return {
          id: a.id,
          actorId: a.actor_id,
          actor: a.actor_id
            ? {
                id: a.actor_id,
                fullName: a.actor_name,
                email: a.actor_email,
                role: a.actor_role,
                avatarUrl: a.actor_avatar,
              }
            : null,
          action: a.action,
          entityType: a.entity_type,
          entityId: a.entity_id,
          entity,
          payload,
          createdAt: a.created_at,
        };
      })
    );

    return {
      teamHoursThisWeek: Number(teamThisWeek?.total ?? 0),
      overdueTaskCount: Number(overdueTasks?.c ?? 0),
      topProjects: topProjects.map((p: any) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        color: p.color,
        total: Number(p.total),
      })),
      recentActivity: recentActivityDecorated,
    };
  });
}
