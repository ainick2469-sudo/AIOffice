import { SPEC_SECTIONS } from './specSchema';

function sectionTitle(key) {
  return SPEC_SECTIONS.find((section) => section.key === key)?.title || key;
}

export default function SpecCompletenessMeter({
  completeness,
  onJumpToSection,
}) {
  const percent = Number(completeness?.percent || 0);
  const missing = Array.isArray(completeness?.missing) ? completeness.missing : [];
  const completed = Number(completeness?.completed || 0);
  const totalRequired = Number(completeness?.totalRequired || 0);

  return (
    <section className="spec-meter">
      <div className="spec-meter-head">
        <div>
          <h4>Spec Completeness</h4>
          <p>{completed}/{totalRequired} required sections completed</p>
        </div>
        <span className={`spec-meter-pill ${percent >= 70 ? 'good' : 'warn'}`}>{percent}%</span>
      </div>

      <div className="spec-meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span className="spec-meter-fill" style={{ width: `${percent}%` }} />
      </div>

      {missing.length > 0 ? (
        <div className="spec-meter-missing">
          <strong>Missing sections</strong>
          <div className="spec-meter-jumps">
            {missing.map((key) => (
              <button
                key={key}
                type="button"
                className="msg-action-btn ui-btn"
                onClick={() => onJumpToSection?.(key)}
              >
                {sectionTitle(key)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="spec-meter-ready">All required sections are present. Ready for approval review.</div>
      )}
    </section>
  );
}
