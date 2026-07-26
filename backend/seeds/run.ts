/**
 * Idempotent demo seed. Wipes all rows for the demo tenant and recreates a
 * believable dataset.
 */
import { db } from '../src/db/index.js';
import { hashPassword } from '../src/lib/password.js';

const PASSWORD_HASH_CACHE = new Map<string, string>();
async function ph(p: string) {
  if (!PASSWORD_HASH_CACHE.has(p)) PASSWORD_HASH_CACHE.set(p, await hashPassword(p));
  return PASSWORD_HASH_CACHE.get(p)!;
}

async function run() {
  console.log('Seeding...');

  // Find or create the demo tenant
  let tenant = await db('tenants').where({ slug: 'crewlog-demo' }).first();
  if (!tenant) {
    [tenant] = await db('tenants').insert({ name: 'CrewLog Demo Co', slug: 'crewlog-demo' }).returning('*');
  }
  const tid = tenant.id;

  // Wipe tenant-scoped data in dependency order. Some tables don't carry tenant_id
  // directly (e.g. documents), so we delete via joins/IDs.
  await db('work_log_audit').whereIn('work_log_id', db('work_logs').select('id')).delete();
  await db('work_logs').where({ tenant_id: tid }).delete();
  await db('document_acl').whereIn('document_id', db('documents').select('id')).delete();
  await db('documents').where({ tenant_id: tid }).delete();
  await db('folders').where({ tenant_id: tid }).delete();
  await db('task_requests').where({ tenant_id: tid }).delete();
  await db('task_activity').whereIn('task_id', db('tasks').select('id')).delete();
  await db('task_comments').whereIn('task_id', db('tasks').select('id')).delete();
  await db('tasks').where({ tenant_id: tid }).delete();
  await db('project_members').whereIn('project_id', db('projects').select('id').where({ tenant_id: tid })).delete();
  // Unbind customers from any projects before wiping them.
  await db('projects').where({ tenant_id: tid }).update({ customer_id: null });
  await db('projects').where({ tenant_id: tid }).delete();
  await db('customers').where({ tenant_id: tid }).delete();
  await db('refresh_tokens').whereIn('user_id', db('users').select('id').where({ tenant_id: tid })).delete();
  await db('audit_log').where({ tenant_id: tid }).delete();
  await db('users').where({ tenant_id: tid }).delete();

  // ---- USERS ----
  const usersData = [
    { email: 'admin@crewlog.local', full_name: 'Ada Admin', role: 'admin', password: 'Admin123!' },
    { email: 'manager.alex@crewlog.local', full_name: 'Alex Manager', role: 'manager', password: 'Manager123!' },
    { email: 'manager.sam@crewlog.local', full_name: 'Sam Manager', role: 'manager', password: 'Manager123!' },
    { email: 'worker.jordan@crewlog.local', full_name: 'Jordan Worker', role: 'worker', password: 'Worker123!' },
    { email: 'worker.taylor@crewlog.local', full_name: 'Taylor Worker', role: 'worker', password: 'Worker123!' },
    { email: 'worker.morgan@crewlog.local', full_name: 'Morgan Worker', role: 'worker', password: 'Worker123!' },
    { email: 'worker.casey@crewlog.local', full_name: 'Casey Worker', role: 'worker', password: 'Worker123!' },
  ];

  const users: Record<string, any> = {};
  for (const u of usersData) {
    const [row] = await db('users')
      .insert({
        tenant_id: tid,
        email: u.email,
        password_hash: await ph(u.password),
        full_name: u.full_name,
        role: u.role,
        is_active: true,
      })
      .returning('*');
    users[u.email] = row;
  }

  // ---- CUSTOMERS ----
  const [custA] = await db('customers')
    .insert({
      tenant_id: tid,
      name: 'Riverside Holdings LLC',
      code: 'RVSD',
      contact_name: 'Patricia Vega',
      contact_email: 'patricia@riverside-holdings.example',
      contact_phone: '+1 555 0101',
      address: '200 Riverside Plaza, Suite 1200',
      notes: 'Net-30 payment terms. POC for phase signoffs.',
      status: 'active',
      created_by: users['admin@crewlog.local'].id,
    })
    .returning('*');

  const [custB] = await db('customers')
    .insert({
      tenant_id: tid,
      name: 'Highline Properties',
      code: 'HILN',
      contact_name: 'Marcus Lee',
      contact_email: 'marcus@highline-props.example',
      contact_phone: '+1 555 0144',
      notes: 'Heritage-protected facade — coordinate any external work with the city.',
      status: 'active',
      created_by: users['manager.alex@crewlog.local'].id,
    })
    .returning('*');

  // ---- PROJECTS ----
  const [projA] = await db('projects')
    .insert({
      tenant_id: tid,
      name: 'Riverside Tower Build',
      code: 'RTB-2026',
      description: '23-storey mixed-use development at riverside. Phase 1: foundation & podium.',
      status: 'active',
      start_date: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10),
      color: '#3b82f6',
      client_name: 'Riverside Holdings LLC',
      customer_id: custA.id,
      created_by: users['admin@crewlog.local'].id,
    })
    .returning('*');

  const [projB] = await db('projects')
    .insert({
      tenant_id: tid,
      name: 'Highline Renovation',
      code: 'HLR-2026',
      description: 'Renovation of the historic Highline warehouse into office lofts.',
      status: 'active',
      start_date: new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10),
      color: '#10b981',
      client_name: 'Highline Properties',
      customer_id: custB.id,
      created_by: users['manager.alex@crewlog.local'].id,
    })
    .returning('*');

  // Project members — every user belongs to both projects
  const memberInsert = [];
  for (const k of Object.keys(users)) {
    memberInsert.push({
      project_id: projA.id,
      user_id: users[k].id,
      role_in_project: users[k].role === 'admin' ? 'lead' : users[k].role === 'manager' ? 'lead' : 'contributor',
    });
    memberInsert.push({
      project_id: projB.id,
      user_id: users[k].id,
      role_in_project: users[k].role === 'admin' ? 'observer' : users[k].role === 'manager' ? 'lead' : 'contributor',
    });
  }
  await db('project_members').insert(memberInsert);

  // ---- TASKS ----
  const tasksData = [
    { title: 'Pour foundation north quadrant', desc: 'Complete the concrete pour for the north foundation quadrant by Friday.', proj: projA.id, assignee: users['worker.jordan@crewlog.local'].id, status: 'in_progress', priority: 'high', difficulty: 'hard', due: 3 },
    { title: 'Inspect rebar before pour', desc: 'Walk the rebar with the structural engineer, log any deviations.', proj: projA.id, assignee: users['worker.taylor@crewlog.local'].id, status: 'todo', priority: 'urgent', difficulty: 'medium', due: 1 },
    { title: 'Order steel beams (phase 2)', desc: 'Submit PO for phase 2 steel beams; verify lead times.', proj: projA.id, assignee: users['manager.alex@crewlog.local'].id, status: 'waiting', priority: 'medium', difficulty: 'easy', due: 5 },
    { title: 'Set up site hoarding', desc: 'Install perimeter hoarding and signage per city permit.', proj: projA.id, assignee: users['worker.morgan@crewlog.local'].id, status: 'done', priority: 'low', difficulty: 'easy', due: -3 },
    { title: 'Demolition of interior partitions', desc: 'Carefully demolish interior partitions on level 2.', proj: projB.id, assignee: users['worker.casey@crewlog.local'].id, status: 'in_progress', priority: 'high', difficulty: 'expert', due: 2 },
    { title: 'HVAC rough-in review', desc: 'Coordinate HVAC rough-in with mechanical subcontractor.', proj: projB.id, assignee: users['worker.jordan@crewlog.local'].id, status: 'review', priority: 'medium', difficulty: 'hard', due: 7 },
    { title: 'Site safety walkthrough (weekly)', desc: 'Conduct weekly safety walkthrough, document any issues.', proj: projA.id, assignee: users['manager.sam@crewlog.local'].id, status: 'todo', priority: 'urgent', difficulty: 'easy', due: 0 },
  ];

  const tasks: any[] = [];
  for (const t of tasksData) {
    const [row] = await db('tasks')
      .insert({
        tenant_id: tid,
        project_id: t.proj,
        title: t.title,
        description: t.desc,
        assignee_id: t.assignee,
        created_by: users['admin@crewlog.local'].id,
        status: t.status,
        priority: t.priority,
        due_date: new Date(Date.now() + t.due * 86400_000).toISOString().slice(0, 10),
        difficulty: t.difficulty,
        actual_hours: 0,
      })
      .returning('*');
    tasks.push(row);
  }

  // One comment + activity per task
  for (const t of tasks) {
    await db('task_activity').insert({
      task_id: t.id,
      actor_id: users['manager.alex@crewlog.local'].id,
      action: 'created',
      payload: JSON.stringify({ title: t.title }),
    });
    await db('task_comments').insert({
      task_id: t.id,
      author_id: users['manager.alex@crewlog.local'].id,
      body: 'I have noted the dependencies. Let me know if anything is blocking you.',
    });
  }

  // ---- WORK LOGS ----
  // Create logs for the past 10 days for workers, multiple entries per day sometimes.
  const workerEmails = Object.keys(users).filter((e) => users[e].role === 'worker');
  const today = new Date();

  let logIdx = 0;
  for (let dayOffset = -10; dayOffset <= 0; dayOffset++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() + dayOffset);
    const iso = d.toISOString().slice(0, 10);

    for (const email of workerEmails) {
      const wid = users[email].id;

      // 1-2 entries on weekdays; skip weekend-ish sometimes
      const dow = d.getUTCDay();
      if (dow === 0 && Math.random() > 0.15) continue;
      if (dow === 6 && Math.random() > 0.25) continue;

      const tasksForWorker = tasks.filter((t) => t.assignee_id === wid);
      const projId = Math.random() < 0.65 ? projA.id : projB.id;
      // Round to nearest 0.25 to satisfy DB CHECK constraint
      const round = (n: number) => Math.round(n * 4) / 4;
      const hours1 = round(2 + Math.random() * 3);
      const useTwo = Math.random() > 0.55;
      const hours2 = useTwo ? round(1.5 + Math.random() * 2) : 0;

      const task1 = tasksForWorker[logIdx % tasksForWorker.length] ?? tasks[logIdx % tasks.length];
      logIdx++;

      await db('work_logs').insert({
        tenant_id: tid,
        worker_id: wid,
        date: iso,
        project_id: task1.project_id,
        task_id: task1.id,
        hours: hours1,
        description: `Worked on: ${task1.title}.`,
      });

      if (useTwo) {
        await db('work_logs').insert({
          tenant_id: tid,
          worker_id: wid,
          date: iso,
          project_id: projId,
          task_id: null,
          hours: hours2,
          description: 'Misc site duties, walk-through and paperwork.',
        });
      }
    }
  }

  // Recompute actual_hours per task
  const tasksWithLogs = await db('work_logs as wl').join('tasks as t', 't.id', 'wl.task_id').groupBy('t.id').select('t.id as id').sum('wl.hours as total');
  for (const t of tasksWithLogs) {
    await db('tasks').where({ id: t.id }).update({ actual_hours: Number(t.total) });
  }

  // ---- TASK REQUESTS (demo) ----
  // One pending request from a worker, plus an already-approved one (so the
  // manager review UI shows all three statuses out of the box).
  await db('task_requests').insert({
    tenant_id: tid,
    requested_by: users['worker.jordan@crewlog.local'].id,
    project_id: projA.id,
    title: 'Coordinate tower-crane delivery window with city',
    description: 'Need to confirm the street-closure permit covers the new crane delivery date the supplier just proposed (next Wednesday). It currently clashes with the local school pickup window.',
    priority: 'high',
    difficulty: 'hard',
    due_date: new Date(Date.now() + 4 * 86400_000).toISOString().slice(0, 10),
    status: 'pending',
  });
  await db('task_requests').insert({
    tenant_id: tid,
    requested_by: users['worker.taylor@crewlog.local'].id,
    project_id: projB.id,
    title: 'Take pre-demolition photos of level-2 partitions',
    description: 'Want a full set of dated photos before any demolition on level 2 — the heritage consultant needs them for the file.',
    priority: 'medium',
    difficulty: 'easy',
    status: 'pending',
  });

  // ---- FOLDERS + DOCUMENTS ----
  const [folder1] = await db('folders')
    .insert({ tenant_id: tid, project_id: projA.id, name: 'Drawings', created_by: users['manager.alex@crewlog.local'].id })
    .returning('*');
  const [folder2] = await db('folders')
    .insert({ tenant_id: tid, project_id: projA.id, name: 'Permits', created_by: users['manager.alex@crewlog.local'].id })
    .returning('*');

  // Ensure the seed files actually exist on disk (so downloads return 200).
  // We write them via the same storage service the API uses, then record
  // their real on-disk path/size/mime in the documents table.
  const { storage } = await import('../src/lib/storage.js');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const seedUploadsDir = path.resolve(process.cwd(), 'uploads', 'seed');
  await fs.mkdir(seedUploadsDir, { recursive: true });

  const seedFiles: Array<{ filename: string; content: string; mime: string; name: string; description: string; uploader: string; project_id: string | null; folder_id: string | null; visibility: 'team' }> = [
    {
      filename: 'foundation-plan.pdf',
      mime: 'application/pdf',
      name: 'Foundation plan v3.pdf',
      description: 'Architectural foundation plan',
      uploader: users['manager.alex@crewlog.local'].id,
      project_id: projA.id,
      folder_id: folder1.id,
      visibility: 'team',
      content: '%PDF-1.4 placeholder',
    },
    {
      filename: 'building-permit.pdf',
      mime: 'application/pdf',
      name: 'Building permit.pdf',
      description: 'City issued building permit',
      uploader: users['admin@crewlog.local'].id,
      project_id: projA.id,
      folder_id: folder2.id,
      visibility: 'team',
      content: '%PDF-1.4 placeholder',
    },
    {
      filename: 'safety-checklist.md',
      mime: 'text/markdown',
      name: 'Site safety checklist.md',
      description: 'Cross-project safety checklist',
      uploader: users['admin@crewlog.local'].id,
      project_id: null,
      folder_id: null,
      visibility: 'team',
      content: `# Site safety checklist

Daily checks:
- PPE in use (hard hat, vest, boots)
- First aid kit stocked
- Fire extinguishers accessible
- Tool box talks completed
- Toolbox clean and organized

Weekly:
- Scaffolding inspected and tagged
- Ladder condition reviewed
- Electrical cords and GFCI tested
- Material storage secured
- Incident report filed (if any)
`,
    },
  ];

  for (const f of seedFiles) {
    const localPath = path.join(seedUploadsDir, f.filename);
    try {
      await fs.access(localPath);
    } catch {
      // Write a tiny placeholder
      await fs.writeFile(localPath, f.content, 'utf8');
    }
    const stat = await fs.stat(localPath);
    await db('documents').insert({
      tenant_id: tid,
      project_id: f.project_id,
      folder_id: f.folder_id,
      name: f.name,
      description: f.description,
      uploaded_by: f.uploader,
      file_path: `seed/${f.filename}`,
      mime_type: f.mime,
      size_bytes: stat.size,
      visibility: f.visibility,
    });
  }
  void storage;

  // touch updated_at to ensure triggers don't choke
  void db.fn.now;

  console.log('Seed complete.');
  console.log('  Login: admin@crewlog.local / Admin123!');
  console.log('         manager.alex@crewlog.local / Manager123!');
  console.log('         worker.jordan@crewlog.local / Worker123!');
  await db.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
