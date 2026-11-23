import React, { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { courseToneClass } from '../lib/classColors.js';
import { formatWeeks } from '../lib/weeks.js';
import { WEEKDAY_LABELS } from '../lib/time.js';
import {
  formatMaterialDate,
  formatMaterialSize,
  isImageMaterial,
  materialBadge,
  materialKind,
} from '../lib/materials.js';
import Modal from './Modal.jsx';
import {
  BookIcon,
  ExternalLinkIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from './Icons.jsx';

function sessionSummary(session) {
  const day = WEEKDAY_LABELS[session.day - 1] || '';
  const periods =
    session.start === session.end
      ? `第${session.start}节`
      : `第${session.start}-${session.end}节`;
  return {
    day,
    periods,
    location: session.location || '未填写教室',
    weeks: formatWeeks(session.weeks),
  };
}

export default function CourseDetail({ course: initialCourse, onClose, onEdit }) {
  const { courses, materials, actions, notify } = useStore();
  const course = courses.find((item) => item.id === initialCourse.id) || initialCourse;
  const courseMaterials = useMemo(
    () => materials.filter((material) => material.courseId === course.id),
    [materials, course.id]
  );
  const api = typeof window !== 'undefined' ? window.coursepilotDesktop?.materials : null;
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  const sessions = useMemo(
    () =>
      [...(course.sessions || [])].sort(
        (a, b) => a.day - b.day || a.start - b.start || a.end - b.end
      ),
    [course.sessions]
  );

  const handleAdd = async () => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await api.pick({ courseId: course.id });
      if (!result?.ok) {
        notify(result?.error || '添加课件失败', 'error');
        return;
      }
      const items = Array.isArray(result.items) ? result.items : [];
      const errors = Array.isArray(result.errors) ? result.errors : [];
      if (!items.length) {
        if (errors.length) notify(errors[0], 'error');
        return;
      }
      const saved = await actions.addMaterials(course.id, items);
      if (!saved) {
        await Promise.all(
          items.map((item) => api.delete({ storedPath: item.storedPath }))
        );
        notify('课件记录保存失败，已撤销复制的文件', 'error');
        return;
      }
      if (errors.length) {
        notify(`已添加 ${items.length} 个课件，${errors.length} 个文件未添加：${errors[0]}`, 'error');
      } else {
        notify(`已添加 ${items.length} 个课件`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (material) => {
    if (!api) {
      notify('课件打开功能仅在桌面版可用', 'error');
      return;
    }
    if (isImageMaterial(material.ext)) {
      setPreview({ name: material.originalName, loading: true, dataUrl: '' });
      const result = await api.readImage({ storedPath: material.storedPath });
      if (!result?.ok) {
        setPreview(null);
        notify(result?.error || '图片读取失败', 'error');
        return;
      }
      setPreview({
        name: material.originalName,
        loading: false,
        dataUrl: result.dataUrl,
      });
      return;
    }
    const result = await api.open({ storedPath: material.storedPath });
    if (!result?.ok) notify(result?.error || '无法打开课件', 'error');
  };

  const handleRemove = async (material) => {
    const confirmed = window.confirm(
      `确定移除课件“${material.originalName}”吗？\n\nCoursePilot 中复制的文件会被删除，原下载文件不受影响。`
    );
    if (!confirmed) return;
    const removed = await actions.removeMaterial(material.id);
    if (!removed) return;
    if (api) {
      const result = await api.delete({ storedPath: material.storedPath });
      if (!result?.ok) {
        notify(result?.error || '课件记录已移除，但文件删除失败，请手动清理', 'error');
        return;
      }
    }
    notify('课件已移除');
  };

  return (
    <Modal
      title="课程详情"
      onClose={onClose}
      wide
      footer={
        <div className="modal-foot-inner">
          <span className="course-detail-foot-note">
            {courseMaterials.length} 个课件 · 保存在本机
          </span>
          <div className="modal-foot-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onEdit(course)}>
              <PencilIcon size={16} />
              编辑课程
            </button>
          </div>
        </div>
      }
    >
      <div className="course-detail">
        <div className={`course-detail-hero ${courseToneClass(course.colorIndex)}`}>
          <div className="course-detail-title">
            <span className="course-detail-dot" />
            <div>
              <h2>{course.name}</h2>
              <p>
                {course.teacher || '未填写教师'} · {course.type === 'lab' ? '实验课 / 上机课' : '理论课'}
              </p>
            </div>
          </div>
          <div className="course-detail-stats">
            <span className="course-detail-stat">{sessions.length} 个时间段</span>
          </div>
        </div>

        <div className="course-detail-grid">
          <section className="course-detail-panel">
            <h3>上课安排</h3>
            {sessions.length ? (
              <ul className="course-session-list">
                {sessions.map((session) => {
                  const summary = sessionSummary(session);
                  return (
                    <li className="course-session-item" key={session.id}>
                      <span className="course-session-day">{summary.day}</span>
                      <div className="course-session-main">
                        <strong>
                          {summary.periods} · {summary.location}
                        </strong>
                        <span>{summary.weeks}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="course-detail-empty">还没有设置上课时间，可以点击“编辑课程”补充。</p>
            )}
            {course.note ? <div className="course-note">{course.note}</div> : null}
          </section>

          <section className="course-detail-panel">
            <div className="course-materials-head">
              <h3>
                课件 <span className="course-materials-count">{courseMaterials.length}</span>
              </h3>
              {api ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAdd} disabled={busy}>
                  <PlusIcon size={14} />
                  {busy ? '正在添加…' : '添加课件'}
                </button>
              ) : null}
            </div>
            <p className="course-materials-hint">
              支持 Word、PPT、PDF 和图片，可一次添加多个文件。
            </p>

            {courseMaterials.length ? (
              <ul className="material-list">
                {courseMaterials.map((material) => {
                  const kind = materialKind(material.ext);
                  return (
                    <li className="material-row" key={material.id}>
                      <button
                        type="button"
                        className="material-main"
                        onClick={() => handleOpen(material)}
                        title={isImageMaterial(material.ext) ? `预览 ${material.originalName}` : `打开 ${material.originalName}`}
                      >
                        <span className={`material-badge is-${kind}`}>
                          {materialBadge(material.ext)}
                        </span>
                        <span className="material-text">
                          <span className="material-name">{material.originalName}</span>
                          <span className="material-meta">
                            {formatMaterialSize(material.size)}
                            {formatMaterialDate(material.addedAt)
                              ? ` · ${formatMaterialDate(material.addedAt)} 添加`
                              : ''}
                            {isImageMaterial(material.ext) ? ' · 点击预览' : ' · 点击打开'}
                          </span>
                        </span>
                        <ExternalLinkIcon size={15} className="material-open-icon" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger material-remove"
                        onClick={() => handleRemove(material)}
                        aria-label={`移除课件 ${material.originalName}`}
                        title="移除课件"
                      >
                        <TrashIcon size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="materials-empty">
                <BookIcon size={24} />
                <strong>还没有课件</strong>
                <span>这门课的各周共用课件。</span>
              </div>
            )}
            {!api ? (
              <div className="notice-bar course-materials-web-note">
                <InfoIcon size={15} />
                课件添加和打开仅在桌面版可用；网页预览不会复制本地文件。
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {preview ? (
        <div
          className="material-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div className="material-preview">
            <div className="material-preview-head">
              <strong>{preview.name}</strong>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setPreview(null)}
                aria-label="关闭图片预览"
              >
                <XIcon size={16} />
              </button>
            </div>
            <div className="material-preview-body">
              {preview.loading ? (
                <span className="material-preview-loading">正在读取图片…</span>
              ) : (
                <img src={preview.dataUrl} alt={preview.name} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
