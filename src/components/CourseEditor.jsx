import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { createId } from '../lib/id.js';
import { COURSE_COLORS, courseToneClass, nextColorIndex } from '../lib/classColors.js';
import { formatWeeks, parseWeekText } from '../lib/weeks.js';
import { WEEKDAY_LABELS } from '../lib/time.js';
import Modal from './Modal.jsx';
import { PlusIcon, TrashIcon } from './Icons.jsx';

function toSessionDraft(session) {
  return {
    key: createId('draft'),
    id: session.id,
    day: session.day,
    start: session.start,
    end: session.end,
    location: session.location || '',
    weeksText: session.weeks ? formatWeeks(session.weeks) : '1-16周',
  };
}

export default function CourseEditor({ course, preset, onClose }) {
  const { settings, courses, actions, notify } = useStore();
  const isEdit = Boolean(course);
  const periodOptions = Array.from({ length: settings.periodsPerDay }, (_, index) => index + 1);

  const [name, setName] = useState(course?.name || '');
  const [teacher, setTeacher] = useState(course?.teacher || '');
  const [type, setType] = useState(course?.type || 'theory');
  const [colorIndex, setColorIndex] = useState(
    typeof course?.colorIndex === 'number' ? course.colorIndex : nextColorIndex(courses)
  );
  const [note, setNote] = useState(course?.note || '');
  const [sessions, setSessions] = useState(() => {
    if (course?.sessions?.length) return course.sessions.map(toSessionDraft);
    const day = preset?.day || 1;
    const start = preset?.start || 1;
    return [
      {
        key: createId('draft'),
        day,
        start,
        end: Math.min(start + 1, settings.periodsPerDay),
        location: '',
        weeksText: '1-16周',
      },
    ];
  });
  const [error, setError] = useState('');

  const updateSession = (key, patch) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.key !== key) return session;
        const next = { ...session, ...patch };
        if (patch.start && Number(patch.start) > Number(next.end)) next.end = Number(patch.start);
        if (patch.end && Number(patch.end) < Number(next.start)) next.start = Number(patch.end);
        return next;
      })
    );
  };

  const removeSession = (key) => {
    setSessions((current) => current.filter((session) => session.key !== key));
  };

  const addSession = () => {
    setSessions((current) => [
      ...current,
      {
        key: createId('draft'),
        day: 1,
        start: 1,
        end: Math.min(2, settings.periodsPerDay),
        location: '',
        weeksText: '1-16周',
      },
    ]);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('请填写课程名称。');
      return;
    }
    if (!sessions.length) {
      setError('至少需要一个上课时间段。');
      return;
    }
    for (let index = 0; index < sessions.length; index += 1) {
      const session = sessions[index];
      if (Number(session.start) > Number(session.end)) {
        setError(`第 ${index + 1} 个时间段的开始节次不能大于结束节次。`);
        return;
      }
      if (!parseWeekText(session.weeksText)) {
        setError(
          `第 ${index + 1} 个时间段的周次格式无法识别：“${session.weeksText}”，示例：1-16周 或 1-8,10-16周(单)。`
        );
        return;
      }
    }

    const payload = {
      id: course?.id || createId('course'),
      name: name.trim(),
      teacher: teacher.trim(),
      type,
      colorIndex,
      note: note.trim(),
      sessions: sessions.map((session) => ({
        id: session.id,
        day: Number(session.day),
        start: Number(session.start),
        end: Number(session.end),
        location: session.location.trim(),
        weeks: parseWeekText(session.weeksText),
      })),
    };

    if (!await actions.saveCourse(payload)) return;
    notify(isEdit ? '课程已更新' : '课程已添加');
    onClose();
  };

  const handleDelete = async () => {
    if (!course) return;
    const confirmed = window.confirm(
      `确定删除课程“${course.name}”吗？关联的作业会保留，但会取消与课程的关联。`
    );
    if (!confirmed) return;
    if (!await actions.deleteCourse(course.id)) return;
    notify('课程已删除');
    onClose();
  };

  return (
    <Modal
      title={isEdit ? '编辑课程' : '新增课程'}
      subtitle={isEdit ? '修改课程信息后保存，课表会立即更新' : '填写课程与上课时间段，支持多个时间段和周次设置'}
      onClose={onClose}
      wide
      footer={
        <div className="modal-foot-inner">
          <div>
            {isEdit ? (
              <button type="button" className="btn btn-danger-ghost" onClick={handleDelete}>
                <TrashIcon size={16} />
                删除课程
              </button>
            ) : null}
          </div>
          <div className="modal-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave}>
              保存课程
            </button>
          </div>
        </div>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="field-label">课程名称 *</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：高等数学 A"
            autoFocus
          />
        </label>
        <label className="field">
          <span className="field-label">课程类型</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="theory">理论课</option>
            <option value="lab">实验课 / 上机课</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">任课教师</span>
          <input
            type="text"
            value={teacher}
            onChange={(event) => setTeacher(event.target.value)}
            placeholder="选填"
          />
        </label>
        <div className="field">
          <span className="field-label">课程配色</span>
          <div className="color-swatches">
            {COURSE_COLORS.map((color, index) => (
              <button
                key={color.key}
                type="button"
                className={`color-swatch ${courseToneClass(index)} ${
                  colorIndex === index ? 'is-selected' : ''
                }`}
                title={color.label}
                aria-label={color.label}
                onClick={() => setColorIndex(index)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="session-editor">
        <div className="session-editor-head">
          <span className="field-label">上课时间段</span>
          <button type="button" className="btn btn-soft btn-sm" onClick={addSession}>
            <PlusIcon size={14} />
            添加时间段
          </button>
        </div>

        <div className="session-table">
          <div className="session-table-head">
            <span>星期</span>
            <span>节次</span>
            <span>教室</span>
            <span>周次</span>
            <span />
          </div>
          {sessions.map((session) => (
            <div className="session-row" key={session.key}>
              <select
                value={session.day}
                onChange={(event) => updateSession(session.key, { day: Number(event.target.value) })}
                aria-label="星期"
              >
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="period-range">
                <select
                  value={session.start}
                  onChange={(event) => updateSession(session.key, { start: Number(event.target.value) })}
                  aria-label="开始节次"
                >
                  {periodOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <span className="period-dash">-</span>
                <select
                  value={session.end}
                  onChange={(event) => updateSession(session.key, { end: Number(event.target.value) })}
                  aria-label="结束节次"
                >
                  {periodOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={session.location}
                onChange={(event) => updateSession(session.key, { location: event.target.value })}
                placeholder="如 教1-201"
                aria-label="教室"
              />
              <input
                type="text"
                value={session.weeksText}
                onChange={(event) => updateSession(session.key, { weeksText: event.target.value })}
                placeholder="如 1-16周(单)"
                aria-label="周次"
              />
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                onClick={() => removeSession(session.key)}
                aria-label="删除该时间段"
              >
                <TrashIcon size={16} />
              </button>
            </div>
          ))}
        </div>
        <p className="field-hint">
          周次支持 1-16周、1-8,10-16周、2-16周(双)、1,3,5周 等写法；实验课可单独设置周次与教室。
        </p>
      </div>

      <label className="field">
        <span className="field-label">备注</span>
        <textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="选填，例如考核方式、课程群号等"
        />
      </label>

      {error ? <div className="form-error">{error}</div> : null}
    </Modal>
  );
}
