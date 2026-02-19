export default function HelpPopover({
  title,
  whatIs,
  nextStep,
  commonMistake,
}) {
  return (
    <details className="beginner-help-popover">
      <summary aria-label={`Help for ${title}`}>?</summary>
      <div className="beginner-help-popover-body">
        <h5>{title}</h5>
        <p><strong>What this is:</strong> {whatIs}</p>
        <p><strong>What to do next:</strong> {nextStep}</p>
        <p><strong>Common mistake:</strong> {commonMistake}</p>
      </div>
    </details>
  );
}

