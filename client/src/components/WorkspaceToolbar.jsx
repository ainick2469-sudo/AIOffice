import MoreMenu from './ui/MoreMenu';

export default function WorkspaceToolbar({
  projectName = 'ai-office',
  branch = 'main',
  officeMode = 'discuss',
  hasCreationDraft = false,
  layoutPreset = 'split',
  layoutOptions = [],
  projectSidebarCollapsed = false,
  previewFocus = false,
  beginnerMode = false,
  onSetOfficeMode = null,
  onRequestBuildStart = null,
  onToggleProjectSidebar = null,
  onToggleFocusMode = null,
  onToggleBeginnerMode = null,
  onLayoutPresetChange = null,
  onResetLayout = null,
  onRunBuildLoop = null,
}) {
  const branchLabel = String(branch || 'main').trim() || 'main';
  const isBuildMode = officeMode === 'build';

  const handleBuildModeClick = () => {
    if (hasCreationDraft) return;
    if (isBuildMode) return;
    if (typeof onRequestBuildStart === 'function') {
      onRequestBuildStart();
      return;
    }
    onSetOfficeMode?.('build');
  };

  return (
    <header className="workspace-toolbar">
      <div className="workspace-toolbar-left">
        <span className="workspace-toolbar-project">{projectName}</span>
        <span className="workspace-toolbar-branch">Branch: {branchLabel}</span>
      </div>

      <div className="workspace-toolbar-center">
        <div className="office-mode-switch" role="tablist" aria-label="Workspace modes">
          <button
            type="button"
            className={`mode-chip ${officeMode === 'discuss' ? 'active' : ''}`}
            onClick={() => onSetOfficeMode?.('discuss')}
          >
            Discuss
          </button>
          <button
            type="button"
            className={`mode-chip ${officeMode === 'build' ? 'active' : ''}`}
            onClick={handleBuildModeClick}
            disabled={hasCreationDraft}
            title={hasCreationDraft ? 'Create the project first to enter Build mode.' : ''}
          >
            Build
          </button>
        </div>
      </div>

      <div className="workspace-toolbar-right">
        <button type="button" className="ui-btn workspace-toolbar-btn" onClick={onToggleProjectSidebar}>
          {projectSidebarCollapsed ? 'Show Projects' : 'Hide Projects'}
        </button>
        <button
          type="button"
          className={`ui-btn workspace-toolbar-btn ${previewFocus ? 'ui-btn-primary' : ''}`}
          onClick={onToggleFocusMode}
        >
          {previewFocus ? 'Exit Focus Mode' : 'Focus Mode'}
        </button>

        <MoreMenu label="Workspace actions">
          <div className="workspace-more-menu-section">
            <h4>Layout</h4>
            <label className="workspace-more-layout-row">
              <span>Preset</span>
              <select
                className="ui-input"
                value={layoutPreset}
                onChange={(event) => onLayoutPresetChange?.(event.target.value)}
              >
                {(layoutOptions || []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ui-btn" onClick={onResetLayout}>
              Reset Layout
            </button>
          </div>

          <div className="workspace-more-menu-section">
            <h4>Guidance</h4>
            <button
              type="button"
              className={`ui-btn ${beginnerMode ? 'ui-btn-primary' : ''}`}
              onClick={onToggleBeginnerMode}
            >
              Beginner Mode: {beginnerMode ? 'On' : 'Off'}
            </button>
          </div>

          <div className="workspace-more-menu-section">
            <h4>Preview</h4>
            <button
              type="button"
              className={`ui-btn ${previewFocus ? 'ui-btn-primary' : ''}`}
              onClick={onToggleFocusMode}
            >
              Preview Focus: {previewFocus ? 'On' : 'Off'}
            </button>
          </div>

          <div className="workspace-more-menu-section">
            <h4>Automation</h4>
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              onClick={onRunBuildLoop}
              disabled={hasCreationDraft || !isBuildMode}
              title={hasCreationDraft ? 'Create the project first to run build loop.' : ''}
            >
              Run Build Loop
            </button>
          </div>
        </MoreMenu>
      </div>
    </header>
  );
}
