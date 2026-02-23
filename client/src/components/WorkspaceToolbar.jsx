import MoreMenu from './ui/MoreMenu';

export default function WorkspaceToolbar({
  projectName = 'ai-office',
  branch = 'main',
  layoutPreset = 'split',
  layoutOptions = [],
  projectSidebarCollapsed = false,
  previewFocus = false,
  beginnerMode = false,
  consoleOpen = false,
  consoleHasErrors = false,
  onToggleProjectSidebar = null,
  onToggleFocusMode = null,
  onToggleBeginnerMode = null,
  onLayoutPresetChange = null,
  onResetLayout = null,
  onRunBuildLoop = null,
  onOpenSpec = null,
  onOpenTasks = null,
  onOpenGit = null,
  onOpenPreview = null,
  onToggleConsole = null,
}) {
  const branchLabel = String(branch || 'main').trim() || 'main';

  return (
    <header className="workspace-toolbar">
      <div className="workspace-toolbar-left">
        <span className="workspace-toolbar-project">{projectName}</span>
        <span className="workspace-toolbar-branch">Branch: {branchLabel}</span>
      </div>

      <div className="workspace-toolbar-center">
        <div className="workspace-toolbar-flow" data-tooltip="Primary flow: coordinate in Chat, edit in Files, validate in Preview.">
          Workflow: Chat to Files to Preview
        </div>
      </div>

      <div className="workspace-toolbar-right">
        <button
          type="button"
          className="ui-btn workspace-toolbar-btn"
          onClick={onToggleProjectSidebar}
          data-tooltip="Toggle the Projects sidebar."
        >
          {projectSidebarCollapsed ? 'Show Projects' : 'Hide Projects'}
        </button>
        <button
          type="button"
          className={`ui-btn workspace-toolbar-btn ${previewFocus ? 'ui-btn-primary' : ''}`}
          onClick={onToggleFocusMode}
          data-tooltip="Hide side panels for a distraction-free view."
        >
          {previewFocus ? 'Exit Focus Mode' : 'Focus Mode'}
        </button>

        <MoreMenu
          label="Workspace actions"
          triggerTooltip="Open advanced workspace controls."
        >
          <div className="workspace-more-menu-section">
            <h4>Views</h4>
            <button
              type="button"
              className="ui-btn"
              onClick={onOpenSpec}
              data-tooltip="Open Spec in the main workspace pane."
            >
              Open Spec
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={onOpenTasks}
              data-tooltip="Open Tasks to triage and track implementation work."
            >
              Open Tasks
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={onOpenGit}
              data-tooltip="Open Git to inspect diffs and commit safely."
            >
              Open Git
            </button>
            <button
              type="button"
              className={`ui-btn ${consoleOpen ? 'ui-btn-primary' : ''}`}
              onClick={onToggleConsole}
              data-tooltip="Toggle the console output panel."
            >
              Console: {consoleOpen ? 'Open' : 'Closed'}{consoleHasErrors ? ' (errors)' : ''}
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={onOpenPreview}
              data-tooltip="Switch to Preview and inspect the running app."
            >
              Open Preview
            </button>
          </div>

          <div className="workspace-more-menu-section">
            <h4 data-tooltip="Choose a layout. Split shows a secondary pinned pane.">Layout</h4>
            <label className="workspace-more-layout-row">
              <span>Preset</span>
              <select
                className="ui-input"
                value={layoutPreset}
                onChange={(event) => onLayoutPresetChange?.(event.target.value)}
                data-tooltip="Choose a layout. Split shows a secondary pinned pane."
              >
                {(layoutOptions || []).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ui-btn"
              onClick={onResetLayout}
              data-tooltip="Reset pane sizes and pinned views back to calm defaults."
            >
              Reset Layout
            </button>
          </div>

          <div className="workspace-more-menu-section">
            <h4>Guidance</h4>
            <button
              type="button"
              className={`ui-btn ${beginnerMode ? 'ui-btn-primary' : ''}`}
              onClick={onToggleBeginnerMode}
              data-tooltip="Guided UI that explains the workflow. Turn off for a cleaner layout."
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
              data-tooltip="Keep preview in focus while reducing workspace chrome."
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
              data-tooltip="Ask the agents to execute the next build step, then verify with checks and report changes."
            >
              Run Build Loop
            </button>
          </div>
        </MoreMenu>
      </div>
    </header>
  );
}
