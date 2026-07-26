#!/usr/bin/env bash
# End-to-end smoke test against a running backend.
# Usage: bash scripts/smoke.sh [BASE_URL]

set -euo pipefail
BASE="${1:-http://localhost:4000}"
ADMIN_EMAIL="admin@crewlog.local"
ADMIN_PASSWORD="Admin123!"
WORKER_EMAIL="worker.jordan@crewlog.local"
WORKER_PASSWORD="Worker123!"

say() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
fail() { printf "\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }
ok() { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }

JQ_PY() {
  python3 -c "import json,sys; data=json.loads(sys.stdin.read()); print($1)"
}

say "Health"
curl -fsS "$BASE/health" >/dev/null && ok "/health"

say "Admin login"
curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" > /tmp/crewlog_admin.json
ADMIN_TOKEN=$(JQ_PY "data['access']" < /tmp/crewlog_admin.json)
[ -n "$ADMIN_TOKEN" ] || fail "no admin access token"
ok "got admin access token"

say "Worker login"
curl -fsS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$WORKER_EMAIL\",\"password\":\"$WORKER_PASSWORD\"}" > /tmp/crewlog_worker.json
WORKER_TOKEN=$(JQ_PY "data['access']" < /tmp/crewlog_worker.json)
WORKER_ID=$(JQ_PY "data['user']['id']" < /tmp/crewlog_worker.json)
[ -n "$WORKER_TOKEN" ] || fail "no worker access token"
ok "got worker access token (id=$WORKER_ID)"

say "/auth/me (worker)"
curl -fsS "$BASE/api/v1/auth/me" -H "Authorization: Bearer $WORKER_TOKEN" >/dev/null && ok "me works"

say "List projects (admin)"
curl -fsS "$BASE/api/v1/projects" -H "Authorization: Bearer $ADMIN_TOKEN" > /tmp/crewlog_projects.json
PROJECT_ID=$(JQ_PY "next(p['id'] for p in data if p['code']=='RTB-2026')" < /tmp/crewlog_projects.json)
[ -n "$PROJECT_ID" ] || fail "no RTB project id"
ok "picked RTB project $PROJECT_ID"

say "Create task as admin for worker"
TODAY=$(date -u +%F)
curl -fsS -X POST "$BASE/api/v1/tasks" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PROJECT_ID\",\"title\":\"Smoke task\",\"assigneeId\":\"$WORKER_ID\",\"priority\":\"high\",\"dueDate\":\"$TODAY\"}" > /tmp/crewlog_task.json
TASK_ID=$(JQ_PY "data['id']" < /tmp/crewlog_task.json)
TASK_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_task.json)
[ "$TASK_STATUS" = "backlog" ] || fail "expected new task in backlog, got $TASK_STATUS"
ok "task created $TASK_ID in backlog"

say "Worker lists Efor activity types"
ACTIVITY_TYPES=$(curl -fsS "$BASE/api/v1/work_activity_types" -H "Authorization: Bearer $WORKER_TOKEN")
echo "$ACTIVITY_TYPES" | grep -q 'Support' && ok "activity type lookups work"

say "Worker starts, pauses, resumes, and stops task timer"
curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/sessions/start" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' > /tmp/crewlog_session_start.json
SESSION_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_session_start.json)
[ "$SESSION_STATUS" = "running" ] || fail "expected running session, got $SESSION_STATUS"

curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/sessions/pause" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' > /tmp/crewlog_session_pause.json
SESSION_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_session_pause.json)
[ "$SESSION_STATUS" = "paused" ] || fail "expected paused session, got $SESSION_STATUS"

curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/sessions/resume" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' > /tmp/crewlog_session_resume.json
SESSION_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_session_resume.json)
[ "$SESSION_STATUS" = "running" ] || fail "expected resumed session, got $SESSION_STATUS"

curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/sessions/stop" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}' > /tmp/crewlog_session_stop.json
SESSION_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_session_stop.json)
[ "$SESSION_STATUS" = "stopped" ] || fail "expected stopped session, got $SESSION_STATUS"
ok "task timer lifecycle works"

say "Worker creates detailed work log"
curl -fsS -X POST "$BASE/api/v1/work-logs" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"date\":\"$TODAY\",\"projectId\":\"$PROJECT_ID\",\"taskId\":\"$TASK_ID\",\"startTime\":\"09:00\",\"endTime\":\"10:30\",\"module\":\"MM\",\"activityType\":\"Support\",\"location\":\"Office\",\"description\":\"smoke run\"}" \
  > /tmp/crewlog_work_log.json
LOG_ACTIVITY_TYPE=$(JQ_PY "data['activityType']" < /tmp/crewlog_work_log.json)
[ "$LOG_ACTIVITY_TYPE" = "Support" ] || fail "activity type did not round-trip"
ok "detailed work log created"

say "Worker lists own tasks (should include the new one)"
TASKS=$(curl -fsS "$BASE/api/v1/tasks" -H "Authorization: Bearer $WORKER_TOKEN")
echo "$TASKS" | grep -q "$TASK_ID" && ok "worker sees the new task"

say "Worker moves task through review and QA"
curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/status" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"review"}' > /tmp/crewlog_task_review.json
REVIEW_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_task_review.json)
[ "$REVIEW_STATUS" = "review" ] || fail "expected review status, got $REVIEW_STATUS"

curl -fsS -X POST "$BASE/api/v1/tasks/$TASK_ID/status" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"qa"}' > /tmp/crewlog_task_qa.json
QA_STATUS=$(JQ_PY "data['status']" < /tmp/crewlog_task_qa.json)
[ "$QA_STATUS" = "qa" ] || fail "expected QA status, got $QA_STATUS"
ok "review → QA workflow works"

say "Worker fetches /logs/today"
curl -fsS "$BASE/api/v1/work-logs/today" -H "Authorization: Bearer $WORKER_TOKEN" >/dev/null && ok "today endpoint works"

say "Worker uploads document (small text)"
echo "Hello from smoke $(date)" > /tmp/crewlog_smoke.txt
curl -fsS -X POST "$BASE/api/v1/documents" \
  -H "Authorization: Bearer $WORKER_TOKEN" \
  -F "file=@/tmp/crewlog_smoke.txt" \
  -F "projectId=$PROJECT_ID" \
  -F "visibility=team" \
  -F "name=smoke.txt" > /dev/null && ok "document uploaded"

say "Admin CSV export"
HDR=$(curl -s -o /tmp/crewlog.csv -w "%{http_code}" "$BASE/api/v1/work-logs/export.csv?from=$TODAY&to=$TODAY" -H "Authorization: Bearer $ADMIN_TOKEN")
[ "$HDR" = "200" ] || fail "csv export returned $HDR"
[ -s /tmp/crewlog.csv ] && ok "csv export non-empty"

say "Worker cannot access /users"
WORKER_USERS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/users" -H "Authorization: Bearer $WORKER_TOKEN")
[ "$WORKER_USERS" = "403" ] || fail "expected 403, got $WORKER_USERS"
ok "worker blocked from /users as expected"

say "Worker cannot access /api/v1"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/v1/projects" -H "Authorization: Bearer ")
[ "$RESP" = "401" ] || fail "expected 401 without auth, got $RESP"
ok "missing token rejected"

printf "\n\033[1;32m🎉 All smoke tests passed.\033[0m\n"
