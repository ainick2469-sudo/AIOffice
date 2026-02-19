const STATUS_META = {
  pass: {
    label: 'Done',
    className: 'settings-check-status-pass',
  },
  warn: {
    label: 'Needs attention',
    className: 'settings-check-status-warn',
  },
  fail: {
    label: 'Missing',
    className: 'settings-check-status-fail',
  },
};

function resolveStatusMeta(state) {
  const key = String(state || '').trim().toLowerCase();
  return STATUS_META[key] || STATUS_META.fail;
}

export default function SetupChecklist({ items = [] }) {
  return (
    <section className="settings-setup-checklist panel">
      <header className="settings-setup-checklist-head">
        <div>
          <h5>Fix My Setup</h5>
          <p>Do these once. Then building is painless.</p>
        </div>
      </header>

      <div className="settings-setup-checklist-body">
        {(items || []).map((item) => {
          const statusMeta = resolveStatusMeta(item?.state);
          return (
            <article key={item.id} className="settings-check-item">
              <div className="settings-check-main">
                <div className="settings-check-title-row">
                  <strong>{item?.title}</strong>
                  <span className={`settings-status-pill ${statusMeta.className}`}>
                    {statusMeta.label}
                  </span>
                </div>
                <p>{item?.detail}</p>
              </div>
              <div className="settings-check-action">
                <button
                  type="button"
                  className="ui-btn"
                  onClick={() => item?.onAction?.()}
                >
                  {item?.actionLabel || 'Open'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
