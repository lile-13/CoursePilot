import React, { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { useBeijingNow } from '../hooks.js';
import { addDays, diffDays, formatMonthDay, pad2 } from '../lib/time.js';
import { courseToneClass } from '../lib/classColors.js';
import { REMINDER_OPTIONS, getReminderLabel } from '../lib/reminders.js';
import Modal from './Modal.jsx';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CheckIcon,
  ClockIcon,
  TasksIcon,
  BookIcon,
} from './Icons.jsx';

function getDueStatus(assignment, now) {
  if (assignment.status === 'done') return { key: 'done', label: '已完成' };
  const dueAt = assignment.dueAt || '';
  const dueDate = dueAt.slice(0, 10);
  if (!dueDate) return { key: 'todo', label: '待完成' };
  const nowValue = `${now.dateStr}T${pad2(now.hh)}:${pad2(now.mm)}`;
  if (dueAt < nowValue) return { key: 'overdue', label: '已逾期' };
  if (dueDate === now.dateStr) return { key: 'today', label: '今天截止' };
  return { key: 'todo', label: '待完成' };
}

function getDueInfo(dueAt, now, isDone = false) {
  if (!dueAt) return '未设置截止时间';
  const datePart = dueAt.slice(0, 10);
  const timePart = dueAt.slice(11, 16);
  if (isDone) return `截止 ${formatMonthDay(datePart)} ${timePart}`;
  const days = diffDays(now.dateStr, datePart);
  let relative = '';
  if (days === 0) relative = '今天';
  else if (days === 1) relative = '明天';
  else if (days === 2) relative = '后天';
  else if (days > 0) relative = `还剩 ${days} 天`;
  else relative = `已逾期 ${Math.abs(days)} 天`;
  return `${relative} · ${formatMonthDay(datePart)} ${timePart}`;
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待完成' },
  { key: 'overdue', label: '已逾期' },
  { key: 'today', label: '今天' },
  { key: 'done', label: '已完成' },
];

function AssignmentEditor({ assignment, courses, now, onClose }) {
  const { actions, notify } = useStore();
  const isEdit = Boolean(assignment);
  const [title, setTitle] = useState(assignment?.title || '');
  const [courseId, setCourseId] = useState(assignment?.courseId || '');
  const [dueDate, setDueDate] = useState(assignment?.dueAt?.slice(0, 10) || addDays(now.dateStr, 3));
  const [dueTime, setDueTime] = useState(assignment?.dueAt?.slice(11, 16) || '23:59');
  const [notes, setNotes] = useState(assignment?.notes || '');
  const [status, setStatus] = useState(assignment?.status || 'todo');
  const [reminderMinutes, setReminderMinutes] = useState(assignment?.reminderMinutes || 0);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!title.trim()) {
      setError('请填写作业标题。');
      return;
    }
    if (!dueDate || !dueTime) {
      setError('请设置截止日期和时间。');
      return;
    }
    const payload = {
      title: title.trim(),
      courseId: courseId || null,
      dueAt: `${dueDate}T${dueTime}`,
      notes: notes.trim(),
      status,
      reminderMinutes: Number(reminderMinutes) || null,
    };
    const saved = isEdit ? await actions.updateAssignment(assignment.id, payload)
      : await actions.addAssignment(payload);
    if (!saved) return;
    notify(isEdit ? '作业已更新' : '作业已添加');
    onClose();
  };

  return (
    <Modal
      title={isEdit ? '编辑作业' : '新增作业'}
      subtitle="记录截止时间并关联课程，完成后勾选即可归档"
      onClose={onClose}
      footer={
        <div className="modal-foot-inner">
          <span className="field-hint">截止时间按北京时间计算</span>
          <div className="modal-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              保存作业
            </button>
          </div>
        </div>
      }
    >
      <label className="field">
        <span className="field-label">作业标题 *</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：第三章习题 / 实验报告二"
          autoFocus
        />
      </label>

      <div className="form-grid">
        <label className="field">
          <span className="field-label">关联课程</span>
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">不关联课程</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">完成状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="todo">待完成</option>
            <option value="done">已完成</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">截止日期 *</span>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">截止时间 *</span>
          <input type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">截止提醒</span>
        <select
          value={reminderMinutes}
          onChange={(event) => setReminderMinutes(Number(event.target.value))}
        >
          {REMINDER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="field-hint">软件运行时，到达提醒时间会弹出 Windows 通知；已完成作业不再提醒。</span>
      </label>

      <label className="field">
        <span className="field-label">备注</span>
        <textarea
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="提交方式、文件命名要求等"
        />
      </label>

      {courses.length === 0 ? (
        <p className="field-hint">还没有课程，导入或新增课程后即可把作业关联到具体课程。</p>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}

export default function AssignmentsPage() {
  const { courses, assignments, actions, notify } = useStore();
  const now = useBeijingNow();
  const [filter, setFilter] = useState('all');
  const [courseFilter, setCourseFilter] = useState('all');
  const [editor, setEditor] = useState(null);

  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const stats = useMemo(() => {
    const result = { todo: 0, overdue: 0, today: 0, done: 0 };
    for (const assignment of assignments) {
      const status = getDueStatus(assignment, now);
      if (status.key === 'done') result.done += 1;
      else {
        result.todo += 1;
        if (status.key === 'overdue') result.overdue += 1;
        if (status.key === 'today') result.today += 1;
      }
    }
    return result;
  }, [assignments, now]);

  const visible = useMemo(() => {
    const list = assignments.filter((assignment) => {
      const status = getDueStatus(assignment, now);
      if (filter === 'todo' && status.key === 'done') return false;
      if (filter === 'overdue' && status.key !== 'overdue') return false;
      if (filter === 'today' && status.key !== 'today') return false;
      if (filter === 'done' && status.key !== 'done') return false;
      if (courseFilter === 'none' && assignment.courseId) return false;
      if (courseFilter !== 'all' && courseFilter !== 'none' && assignment.courseId !== courseFilter) {
        return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const doneA = a.status === 'done' ? 1 : 0;
      const doneB = b.status === 'done' ? 1 : 0;
      if (doneA !== doneB) return doneA - doneB;
      return (a.dueAt || '').localeCompare(b.dueAt || '');
    });
  }, [assignments, now, filter, courseFilter]);

  const handleDelete = async (assignment) => {
    const confirmed = window.confirm(`确定删除作业“${assignment.title}”吗？`);
    if (!confirmed) return;
    if (!await actions.deleteAssignment(assignment.id)) return;
    notify('作业已删除');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>课程作业</h1>
          <p className="page-sub">
            共 {assignments.length} 项作业 · 待完成 {stats.todo} 项
            {stats.overdue > 0 ? ` · ${stats.overdue} 项已逾期` : ' · 暂无逾期'}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditor({ mode: 'create' })}>
            <PlusIcon size={16} />
            新增作业
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <button
          type="button"
          className={`stat-card stat-todo ${filter === 'todo' ? 'is-active' : ''}`}
          onClick={() => setFilter('todo')}
        >
          <span className="stat-value">{stats.todo}</span>
          <span className="stat-label">待完成</span>
        </button>
        <button
          type="button"
          className={`stat-card stat-overdue ${filter === 'overdue' ? 'is-active' : ''}`}
          onClick={() => setFilter('overdue')}
        >
          <span className="stat-value">{stats.overdue}</span>
          <span className="stat-label">已逾期</span>
        </button>
        <button
          type="button"
          className={`stat-card stat-today ${filter === 'today' ? 'is-active' : ''}`}
          onClick={() => setFilter('today')}
        >
          <span className="stat-value">{stats.today}</span>
          <span className="stat-label">今天截止</span>
        </button>
        <button
          type="button"
          className={`stat-card stat-done ${filter === 'done' ? 'is-active' : ''}`}
          onClick={() => setFilter('done')}
        >
          <span className="stat-value">{stats.done}</span>
          <span className="stat-label">已完成</span>
        </button>
      </div>

      <div className="list-toolbar">
        <div className="filter-tabs">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`filter-tab ${filter === item.key ? 'is-active' : ''}`}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="select-sm"
          value={courseFilter}
          onChange={(event) => setCourseFilter(event.target.value)}
          aria-label="按课程筛选"
        >
          <option value="all">全部课程</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
          <option value="none">未关联课程</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state empty-state-slim">
          <div className="empty-icon">
            <TasksIcon size={30} />
          </div>
          <h2>{assignments.length === 0 ? '还没有作业' : '当前筛选下没有作业'}</h2>
          <p>
            {assignments.length === 0
              ? '添加作业并设置截止时间，系统会按时间排序并提醒逾期。'
              : '可以切换筛选条件查看其他作业。'}
          </p>
          {assignments.length === 0 ? (
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => setEditor({ mode: 'create' })}>
                <PlusIcon size={16} />
                新增作业
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="assignment-list">
          {visible.map((assignment) => {
            const status = getDueStatus(assignment, now);
            const course = courseMap.get(assignment.courseId);
            return (
              <div key={assignment.id} className={`assignment-row status-${status.key}`}>
                <button
                  type="button"
                  className={`check-circle ${assignment.status === 'done' ? 'is-done' : ''}`}
                  onClick={() => actions.toggleAssignment(assignment.id)}
                  aria-label={assignment.status === 'done' ? '标记为未完成' : '标记为已完成'}
                >
                  {assignment.status === 'done' ? <CheckIcon size={14} /> : null}
                </button>

                <div className="assignment-main">
                  <div className="assignment-title-line">
                    <span className="assignment-title">{assignment.title}</span>
                    {course ? (
                      <span className={`course-chip ${courseToneClass(course.colorIndex)}`}>
                        <BookIcon size={11} />
                        {course.name}
                      </span>
                    ) : (
                      <span className="course-chip course-chip-empty">未关联课程</span>
                    )}
                    <span className={`due-chip due-${status.key}`}>{status.label}</span>
                  </div>
                  <div className="assignment-meta">
                    <span className="assignment-due">
                      <ClockIcon size={13} />
                      {getDueInfo(assignment.dueAt, now, assignment.status === 'done')}
                    </span>
                    {assignment.reminderMinutes ? (
                      <span className="assignment-reminder">
                        提醒：{getReminderLabel(assignment.reminderMinutes)}
                      </span>
                    ) : null}
                    {assignment.notes ? (
                      <span className="assignment-notes" title={assignment.notes}>
                        {assignment.notes}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="assignment-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setEditor({ mode: 'edit', assignment })}
                    aria-label="编辑作业"
                  >
                    <PencilIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => handleDelete(assignment)}
                    aria-label="删除作业"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor ? (
        <AssignmentEditor
          assignment={editor.assignment}
          courses={courses}
          now={now}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
