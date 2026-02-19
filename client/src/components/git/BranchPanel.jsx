function branchNameError(value) {
  const name = String(value || '').trim();
  if (!name) return 'Branch name is required.';
  if (name.length < 2) return 'Branch name must be at least 2 characters.';
  if (name.startsWith('/') || name.endsWith('/')) return 'Branch name cannot start or end with "/".';
  if (name.includes('..')) return 'Branch name cannot include "..".';
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return 'Use letters, numbers, ., _, -, /.';
  return '';
}

export default function BranchPanel({
  beginnerMode = false,
  branches = [],
  currentBranch = 'main',
  mergeSource = '',
  mergeTarget = 'main',
  onMergeSourceChange,
  onMergeTargetChange,
  onPreviewMerge,
  onApplyMerge,
  mergeResult = null,
  createModalOpen = false,
  onOpenCreateModal,
  onCloseCreateModal,
  newBranchName = '',
  onNewBranchNameChange,
  onCreateBranch,
}) {
  const validationError = branchNameError(newBranchName);
  const branchItems = branches.length > 0 ? branches : [currentBranch || 'main'];

  return (
    <section className="git-branch-panel">
      <header className="git-side-header">
        <h4>Branches</h4>
        <span>{currentBranch || 'main'}</span>
      </header>

      <div className="git-branch-current">
        <label>
          Current branch
          <select value={currentBranch || 'main'} disabled>
            {branchItems.map((branch) => (
              <option key={`current-${branch}`} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="ui-btn" onClick={onOpenCreateModal}>
          Create branch
        </button>
      </div>

      <details className="git-advanced-block" open={!beginnerMode}>
        <summary>{beginnerMode ? 'Advanced merge controls' : 'Merge (safe preview first)'}</summary>
        <div className="git-advanced-body">
          {beginnerMode ? (
            <p className="git-merge-warning">
              Beginner mode keeps merge controls collapsed by default. Expand only when you need branch merges.
            </p>
          ) : null}
          <label>
            Source branch
            <select
              value={mergeSource}
              onChange={(event) => onMergeSourceChange?.(event.target.value)}
            >
              <option value="">Select source</option>
              {branchItems
                .filter((branch) => branch !== mergeTarget)
                .map((branch) => (
                  <option key={`src-${branch}`} value={branch}>
                    {branch}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Target branch
            <select
              value={mergeTarget}
              onChange={(event) => onMergeTargetChange?.(event.target.value)}
            >
              <option value="">Select target</option>
              {branchItems.map((branch) => (
                <option key={`target-${branch}`} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          </label>
          <p className="git-merge-warning">
            Merge can create conflicts. Run preview first, then apply when safe.
          </p>
          <div className="git-merge-actions">
            <button
              type="button"
              className="ui-btn"
              onClick={onPreviewMerge}
              disabled={!mergeSource || !mergeTarget}
            >
              Preview merge
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={onApplyMerge}
              disabled={!mergeSource || !mergeTarget}
            >
              Apply merge
            </button>
          </div>
          {mergeResult ? (
            <div className={`git-merge-result ${mergeResult.ok ? 'ok' : 'error'}`}>
              <strong>{mergeResult.ok ? 'Merge preview result' : 'Merge action failed'}</strong>
              {mergeResult.conflicts?.length > 0 ? (
                <ul>
                  {mergeResult.conflicts.map((conflict) => (
                    <li key={conflict}>{conflict}</li>
                  ))}
                </ul>
              ) : (
                <p>{mergeResult.message || mergeResult.error || mergeResult.stderr || 'No conflicts reported.'}</p>
              )}
            </div>
          ) : (
            <div className="git-merge-placeholder">
              Merge details will appear here after preview/apply.
            </div>
          )}
        </div>
      </details>

      {createModalOpen ? (
        <div className="git-modal-backdrop">
          <div className="git-modal-card" onClick={(event) => event.stopPropagation()}>
            <h4>Create Branch</h4>
            <p>Use a descriptive name like <code>feature/files-tab-modernization</code>.</p>
            <input
              autoFocus
              type="text"
              value={newBranchName}
              onChange={(event) => onNewBranchNameChange?.(event.target.value)}
              placeholder="feature/my-branch"
            />
            {validationError ? <div className="git-modal-error">{validationError}</div> : null}
            <div className="git-modal-actions">
              <button type="button" className="ui-btn" onClick={onCloseCreateModal}>
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                disabled={Boolean(validationError)}
                onClick={onCreateBranch}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
