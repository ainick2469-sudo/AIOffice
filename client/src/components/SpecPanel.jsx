import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SplitPane from './layout/SplitPane';
import SpecCompletenessMeter from './spec/SpecCompletenessMeter';
import SpecWizard from './spec/SpecWizard';
import SpecEditor from './spec/SpecEditor';
import SpecPreview from './spec/SpecPreview';
import SpecHistoryDrawer from './spec/SpecHistoryDrawer';
import { useBeginnerMode } from './beginner/BeginnerModeContext';
import useBodyScrollLock from '../hooks/useBodyScrollLock';
import useEscapeKey from '../hooks/useEscapeKey';
import {
  SPEC_SECTIONS,
  buildSpecMarkdown,
  computeCompleteness,
  createEmptySections,
  listChangedSections,
  parseSpecMarkdown,
  summarizeTextDiff,
} from './spec/specSchema';
import '../styles/spec.css';

const APPROVAL_MIN_COMPLETENESS = 70;

function clampRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0.2) return 0.2;
  if (n > 0.8) return 0.8;
  return n;
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

function splitRatioKey(projectName) {
  const safe = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:spec-split-ratio:${safe}`;
}

function draftKey(channel, projectName) {
  const safeChannel = String(channel || 'main').trim().toLowerCase() || 'main';
  const safeProject = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:spec-draft:${safeChannel}:${safeProject}`;
}

function historyCacheKey(projectName) {
  const safeProject = String(projectName || 'ai-office').trim().toLowerCase() || 'ai-office';
  return `ai-office:spec-history-cache:${safeProject}`;
}

function safeReadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

function wizardToSections(answers, prevSections) {
  const next = { ...(prevSections || createEmptySections()) };
  const goalLines = [answers.goal, answers.users].filter(Boolean).map((line) => `- ${line.trim()}`);
  if (goalLines.length > 0) next.problem_goal = goalLines.join('\n');

  if (answers.platform) {
    next.target_platform = `- ${answers.platform.trim()}`;
  }
  if (answers.core_loop) {
    next.core_loop = `- ${answers.core_loop.trim()}`;
  }

  const featureLines = [];
  if (answers.must) featureLines.push(`### Must\n- ${answers.must.trim()}`);
  if (answers.should) featureLines.push(`### Should\n- ${answers.should.trim()}`);
  if (answers.could) featureLines.push(`### Could\n- ${answers.could.trim()}`);
  if (featureLines.length > 0) next.features = featureLines.join('\n\n');

  if (answers.non_goals) {
    next.non_goals = `- ${answers.non_goals.trim()}`;
  }
  if (answers.ux) {
    next.ux_notes = `- ${answers.ux.trim()}`;
  }
  if (answers.data_state) {
    next.data_state_model = `- ${answers.data_state.trim()}`;
  }
  if (answers.acceptance) {
    next.acceptance_criteria = `- [ ] ${answers.acceptance.trim()}`;
  }
  if (answers.risks) {
    next.risks_unknowns = `- ${answers.risks.trim()}`;
  }
  return next;
}

function createTaskDraftMessage(specMarkdown, completenessPercent, projectName) {
  return [
    `Generate tasks from this spec for project \`${projectName}\`.`,
    `Completeness: ${completenessPercent}%`,
    '',
    'Output requirements:',
    '- Group tasks by epic',
    '- Include acceptance criteria per task',
    '- Prioritize must-have scope first',
    '- Keep duplicates collapsed',
    '',
    'Spec:',
    specMarkdown,
  ].join('\n');
}

export default function SpecPanel({
  channel = 'main',
  onOpenTab = null,
  onDraftRequest = null,
  beginnerMode = false,
}) {
  const { setSpecMetrics } = useBeginnerMode();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [status, setStatus] = useState({ project: 'ai-office', status: 'none', spec_version: null });
  const [sectionValues, setSectionValues] = useState(createEmptySections());
  const [serverSections, setServerSections] = useState(createEmptySections());
  const [ideaBankMd, setIdeaBankMd] = useState('');
  const [history, setHistory] = useState([]);
  const [historyContentsOverrides, setHistoryContentsOverrides] = useState({});
  const [selectedHistory, setSelectedHistory] = useState(null);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAnswers, setWizardAnswers] = useState({});
  const [message, setMessage] = useState('');
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [approvalStep, setApprovalStep] = useState(1);
  const [confirmText, setConfirmText] = useState('');
  const [splitRatioOverrides, setSplitRatioOverrides] = useState({});
  const sectionRefs = useRef({});
  const saveSpecDraftRef = useRef(null);

  const projectName = String(status?.project || 'ai-office').trim() || 'ai-office';
  const splitStorageKey = useMemo(() => splitRatioKey(projectName), [projectName]);
  const draftStorageKey = useMemo(() => draftKey(channel, projectName), [channel, projectName]);
  const cacheStorageKey = useMemo(() => historyCacheKey(projectName), [projectName]);

  const persistedRatio = useMemo(() => {
    try {
      const raw = localStorage.getItem(splitStorageKey);
      return clampRatio(raw ? Number(raw) : 0.52);
    } catch {
      return 0.52;
    }
  }, [splitStorageKey]);
  const splitRatio = splitRatioOverrides[splitStorageKey] ?? persistedRatio;

  const persistedHistoryContents = useMemo(
    () => safeReadJson(cacheStorageKey, {}),
    [cacheStorageKey]
  );
  const historyContents = useMemo(
    () => ({ ...persistedHistoryContents, ...historyContentsOverrides }),
    [persistedHistoryContents, historyContentsOverrides]
  );

  const specMarkdown = useMemo(() => buildSpecMarkdown(sectionValues), [sectionValues]);
  const specTextLength = useMemo(() => specMarkdown.trim().length, [specMarkdown]);
  const completeness = useMemo(() => computeCompleteness(sectionValues), [sectionValues]);
  const changedSections = useMemo(
    () => listChangedSections(serverSections, sectionValues),
    [serverSections, sectionValues]
  );

  const selectedHistoryContent = selectedHistory
    ? String(historyContents[selectedHistory.path] || '')
    : '';
  const showBeginnerSpecCard = beginnerMode && specTextLength < 320;

  useBodyScrollLock(Boolean(approvalModalOpen), 'spec-approval-modal');

  useEffect(() => {
    setSpecMetrics(projectName, {
      length: specTextLength,
      completeness: completeness.percent,
      approved: String(status?.status || '').toLowerCase() === 'approved',
    });
  }, [projectName, specTextLength, completeness.percent, status?.status, setSpecMetrics]);

  const compareSummary = useMemo(() => {
    if (!compareEnabled || !selectedHistory) return { sections: [], lines: null };
    const selectedText = String(historyContents[selectedHistory.path] || '');
    if (!selectedText.trim()) return { sections: [], lines: null };
    if (String(selectedHistory.name || '').toLowerCase().startsWith('spec-')) {
      const selectedSections = parseSpecMarkdown(selectedText);
      return {
        sections: listChangedSections(selectedSections, sectionValues),
        lines: null,
      };
    }
    return {
      sections: [],
      lines: summarizeTextDiff(selectedText, ideaBankMd),
    };
  }, [compareEnabled, selectedHistory, historyContents, sectionValues, ideaBankMd]);

  const setSplitRatio = (nextRatio) => {
    const normalized = clampRatio(nextRatio);
    setSplitRatioOverrides((prev) => ({ ...prev, [splitStorageKey]: normalized }));
    try {
      localStorage.setItem(splitStorageKey, String(normalized));
    } catch {
      // ignore storage failures
    }
  };

  const cacheHistoryContent = useCallback((path, content) => {
    if (!path) return;
    const normalized = String(content || '');
    setHistoryContentsOverrides((prev) => {
      const next = { ...prev, [path]: normalized };
      saveJson(cacheStorageKey, next);
      return next;
    });
  }, [cacheStorageKey]);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/spec/current?channel=${encodeURIComponent(channel || 'main')}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        throw new Error(payload?.detail || payload?.error || 'Failed to load spec');
      }

      const nextStatus = {
        project: payload.project || 'ai-office',
        status: payload.status || 'none',
        spec_version: payload.spec_version || null,
      };

      const serverSpecMd = String(payload.spec_md || '');
      const serverIdeaMd = String(payload.idea_bank_md || '');
      const serverParsedSections = parseSpecMarkdown(serverSpecMd);

      const localDraft = safeReadJson(draftStorageKey, null);
      const useLocalDraft = Boolean(
        localDraft
        && (localDraft.spec_md || localDraft.idea_bank_md)
        && (
          String(localDraft.spec_md || '') !== serverSpecMd
          || String(localDraft.idea_bank_md || '') !== serverIdeaMd
        )
      );

      const effectiveSpecMd = useLocalDraft ? String(localDraft.spec_md || serverSpecMd) : serverSpecMd;
      const effectiveIdeaMd = useLocalDraft ? String(localDraft.idea_bank_md || serverIdeaMd) : serverIdeaMd;
      const effectiveSections = parseSpecMarkdown(effectiveSpecMd);

      setStatus(nextStatus);
      setServerSections(serverParsedSections);
      setSectionValues(effectiveSections);
      setIdeaBankMd(effectiveIdeaMd);
      setWizardAnswers({});
      setSelectedHistory(null);
      setCompareEnabled(false);
      setConfirmText('');

      if (useLocalDraft) {
        setMessage('Restored unsaved local draft.');
      }

      if (nextStatus.spec_version) {
        cacheHistoryContent(`spec-${nextStatus.spec_version}`, serverSpecMd);
        cacheHistoryContent(`ideas-${nextStatus.spec_version}`, serverIdeaMd);
      }

      if (nextStatus.project) {
        const historyResponse = await fetch(
          `/api/spec/history?project=${encodeURIComponent(nextStatus.project)}&limit=30`
        );
        const historyPayload = historyResponse.ok ? await historyResponse.json() : { items: [] };
        const items = Array.isArray(historyPayload?.items) ? historyPayload.items : [];
        setHistory(items);

        if (nextStatus.spec_version) {
          const specName = `spec-${nextStatus.spec_version}.md`;
          const ideasName = `ideas-${nextStatus.spec_version}.md`;
          const currentSpecItem = items.find((item) => item.name === specName);
          const currentIdeasItem = items.find((item) => item.name === ideasName);
          if (currentSpecItem?.path) cacheHistoryContent(currentSpecItem.path, serverSpecMd);
          if (currentIdeasItem?.path) cacheHistoryContent(currentIdeasItem.path, serverIdeaMd);
        }
      }
    } catch (err) {
      setMessage(err?.message || 'Failed to load spec');
    } finally {
      setLoading(false);
    }
  }, [channel, draftStorageKey, cacheHistoryContent]);

  useEffect(() => {
    loadCurrent();
  }, [loadCurrent]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveJson(draftStorageKey, {
        updated_at: new Date().toISOString(),
        spec_md: specMarkdown,
        idea_bank_md: ideaBankMd,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [draftStorageKey, specMarkdown, ideaBankMd]);

  const saveSpecDraft = useCallback(async ({ silent = false } = {}) => {
    setSaving(true);
    if (!silent) setMessage('');
    try {
      const response = await fetch('/api/spec/current', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel || 'main',
          spec_md: specMarkdown,
          idea_bank_md: ideaBankMd,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        throw new Error(payload?.detail || payload?.error || 'Failed to save spec draft');
      }

      const savedSections = parseSpecMarkdown(String(payload.spec_md || specMarkdown));
      setStatus((prev) => ({
        ...prev,
        project: payload.project || prev.project || 'ai-office',
        status: payload.status || 'draft',
        spec_version: payload.spec_version || prev.spec_version,
      }));
      setServerSections(savedSections);
      setSectionValues(savedSections);
      setIdeaBankMd(String(payload.idea_bank_md || ideaBankMd));
      if (payload.spec_version) {
        cacheHistoryContent(`spec-${payload.spec_version}`, String(payload.spec_md || specMarkdown));
        cacheHistoryContent(`ideas-${payload.spec_version}`, String(payload.idea_bank_md || ideaBankMd));
      }

      if (!silent) {
        setMessage(`Saved draft v${payload.version || payload.spec_version || '?'}.`);
      }
      await loadCurrent();
    } catch (err) {
      setMessage(err?.message || 'Failed to save spec draft');
    } finally {
      setSaving(false);
    }
  }, [channel, specMarkdown, ideaBankMd, cacheHistoryContent, loadCurrent]);

  useEffect(() => {
    saveSpecDraftRef.current = saveSpecDraft;
  }, [saveSpecDraft]);

  const jumpToSection = (key) => {
    const node = sectionRefs.current?.[key];
    if (node && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    const section = SPEC_SECTIONS.find((item) => item.key === key);
    window.dispatchEvent(new CustomEvent('chat-context:add', {
      detail: {
        id: `spec:${key}`,
        type: 'spec',
        label: section?.title || key,
        value: key,
      },
    }));
  };

  const openApprovalModal = () => {
    setApprovalStep(1);
    setApprovalModalOpen(true);
    setConfirmText('');
  };

  const closeApprovalModal = useCallback(() => {
    setApprovalModalOpen(false);
    setApprovalStep(1);
    setConfirmText('');
  }, []);

  useEscapeKey((event) => {
    if (!approvalModalOpen) return;
    closeApprovalModal();
    event.preventDefault();
  }, approvalModalOpen);

  useEffect(() => {
    const onGlobalEscape = (event) => {
      if (!approvalModalOpen) return;
      closeApprovalModal();
      if (event?.detail) event.detail.handled = true;
    };
    const onResetUi = () => closeApprovalModal();
    window.addEventListener('ai-office:escape', onGlobalEscape);
    window.addEventListener('ai-office:reset-ui-state', onResetUi);
    return () => {
      window.removeEventListener('ai-office:escape', onGlobalEscape);
      window.removeEventListener('ai-office:reset-ui-state', onResetUi);
    };
  }, [approvalModalOpen, closeApprovalModal]);

  const runApprove = async () => {
    if (completeness.percent < APPROVAL_MIN_COMPLETENESS) {
      setMessage(`Approval blocked: completeness is ${completeness.percent}%. Fill required sections first.`);
      return;
    }
    if (confirmText.trim().toUpperCase() !== 'APPROVE SPEC') {
      setMessage("Type 'APPROVE SPEC' to confirm approval.");
      return;
    }

    setApproving(true);
    setMessage('');
    try {
      const response = await fetch('/api/spec/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: channel || 'main',
          confirm_text: confirmText,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.error) {
        throw new Error(payload?.detail || payload?.error || 'Failed to approve spec');
      }
      setStatus((prev) => ({
        ...prev,
        status: payload.status || 'approved',
      }));
      closeApprovalModal();
      setMessage('Spec approved. Build actions can now proceed.');
      await loadCurrent();
    } catch (err) {
      setMessage(err?.message || 'Failed to approve spec');
    } finally {
      setApproving(false);
    }
  };

  const handleWizardAnswerChange = (id, value) => {
    setWizardAnswers((prev) => {
      const nextAnswers = { ...prev, [id]: value };
      setSectionValues((current) => wizardToSections(nextAnswers, current));
      return nextAnswers;
    });
  };

  const handleSectionChange = (key, value) => {
    setSectionValues((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    const onInsertDraft = (event) => {
      const sectionKey = String(event?.detail?.sectionKey || '').trim();
      const text = String(event?.detail?.text || '').trim();
      if (!sectionKey || !text) return;
      if (!SPEC_SECTIONS.some((section) => section.key === sectionKey)) return;
      setSectionValues((prev) => {
        const current = String(prev?.[sectionKey] || '').trim();
        const nextValue = current ? `${current}\n- ${text}` : `- ${text}`;
        return { ...prev, [sectionKey]: nextValue };
      });
      setMessage(`Inserted chat excerpt into ${sectionKey}.`);
      onOpenTab?.('spec');
    };
    window.addEventListener('specpanel:insert-draft', onInsertDraft);
    return () => window.removeEventListener('specpanel:insert-draft', onInsertDraft);
  }, [onOpenTab]);

  const openTasksDraft = () => {
    const draft = createTaskDraftMessage(specMarkdown, completeness.percent, projectName);
    if (typeof onDraftRequest === 'function') {
      onDraftRequest(draft);
      setMessage('Task-generation draft sent to chat.');
    } else {
      try {
        navigator.clipboard.writeText(draft);
        setMessage('Task-generation draft copied to clipboard.');
      } catch {
        setMessage('Unable to open draft in chat. Copy manually from preview.');
      }
    }
    onOpenTab?.('chat');
  };

  const openBuildMode = () => {
    onOpenTab?.('files');
    setMessage('Switched to build workspace.');
  };

  const selectHistoryItem = async (item) => {
    setSelectedHistory(item);
    if (!item?.path) return;
    if (historyContents[item.path]) return;

    if (item.path && item.name) {
      if (item.name.startsWith('spec-') && status.spec_version && item.name === `spec-${status.spec_version}.md`) {
        cacheHistoryContent(item.path, specMarkdown);
        return;
      }
      if (item.name.startsWith('ideas-') && status.spec_version && item.name === `ideas-${status.spec_version}.md`) {
        cacheHistoryContent(item.path, ideaBankMd);
        return;
      }
    }

    try {
      const response = await fetch(
        `/api/files/read?channel=${encodeURIComponent(channel)}&path=${encodeURIComponent(item.path)}`
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload?.ok) {
        cacheHistoryContent(item.path, String(payload.content || ''));
        return;
      }
    } catch {
      // ignore fallback
    }

    cacheHistoryContent(
      item.path,
      `# ${item.name}\n\nContent is not accessible via current APIs for this snapshot path.\n\nPath: \`${item.path}\``
    );
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.ctrlKey) return;
      const key = String(event.key || '').toLowerCase();

      if (key === 's') {
        event.preventDefault();
        saveSpecDraftRef.current?.({ silent: true })
          .then(() => setMessage('Draft saved.'))
          .catch(() => {});
      }

      if (key === 'enter' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setApprovalStep(1);
        setApprovalModalOpen(true);
        setConfirmText('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="panel spec-panel-v2">
      <div className="panel-header spec-panel-header">
        <div>
          <h3>Spec</h3>
          <p>Define what we are building, why it matters, and what done looks like.</p>
        </div>
        <div className="spec-panel-header-meta">
          <span className="pill ui-chip">Project: {projectName}</span>
          <span className={`pill ui-chip ${String(status.status || '').toLowerCase() === 'approved' ? 'is-active' : ''}`}>
            Status: {String(status.status || 'none').toUpperCase()}
          </span>
          {status.spec_version ? <span className="pill ui-chip">v{status.spec_version}</span> : null}
        </div>
      </div>

      <div className="panel-body spec-panel-body">
        <div className="spec-next-steps-strip">
          <div className="spec-next-steps-copy">
            <strong>Next Steps</strong>
            <span>Move from planning into execution once the spec is solid.</span>
          </div>
          <div className="spec-next-steps-actions">
            <button type="button" className="control-btn ui-btn" onClick={openTasksDraft}>
              Generate Tasks (Draft)
            </button>
            <button type="button" className="control-btn ui-btn" onClick={openBuildMode}>
              Open Build Mode
            </button>
          </div>
        </div>

        <SpecCompletenessMeter completeness={completeness} onJumpToSection={jumpToSection} />

        {showBeginnerSpecCard ? (
          <div className="beginner-empty-card">
            <h4>Start with the Spec Wizard</h4>
            <p>
              Fill the guided answers first. This gives the build loop clear scope and acceptance criteria.
            </p>
            <div className="beginner-empty-actions">
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={() => setWizardOpen(true)}
              >
                Open Spec Wizard
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={() => onOpenTab?.('chat')}
              >
                Ask chat for help
              </button>
            </div>
          </div>
        ) : null}

        <SpecWizard
          enabled={wizardOpen}
          onToggle={() => setWizardOpen((prev) => !prev)}
          answers={wizardAnswers}
          onAnswerChange={handleWizardAnswerChange}
        />

        <div className="spec-toolbar">
          <div className="spec-toolbar-left">
            <button type="button" className="control-btn ui-btn" onClick={loadCurrent} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button type="button" className="control-btn ui-btn ui-btn-primary" onClick={() => saveSpecDraft()} disabled={saving}>
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button type="button" className="control-btn ui-btn" onClick={openApprovalModal}>
              Approve Spec
            </button>
          </div>
          <div className="spec-toolbar-right">
            <span className="pill ui-chip">Ctrl+S Save</span>
            <span className="pill ui-chip">Ctrl+Enter Approve</span>
          </div>
        </div>

        <div className="spec-split-shell">
          <SplitPane
            direction="vertical"
            ratio={splitRatio}
            defaultRatio={0.52}
            minPrimary={420}
            minSecondary={360}
            onRatioChange={setSplitRatio}
          >
            <section className="spec-pane spec-pane-editor">
              <div className="spec-pane-title">
                <h4>Editor</h4>
                <p>Fill each required section. Missing sections are gently highlighted.</p>
              </div>
              <SpecEditor
                sections={SPEC_SECTIONS}
                values={sectionValues}
                missingKeys={completeness.missing}
                sectionRefs={sectionRefs}
                onChangeSection={handleSectionChange}
                ideaBankMd={ideaBankMd}
                onChangeIdeaBank={setIdeaBankMd}
                onJumpToSection={jumpToSection}
              />
            </section>

            <section className="spec-pane spec-pane-preview">
              <div className="spec-pane-title">
                <h4>Preview</h4>
                <p>Review structure, readability, and readiness before approval.</p>
              </div>

              <SpecPreview
                markdown={specMarkdown}
                ideaBankMd={ideaBankMd}
                selectedHistory={selectedHistory}
                historyContent={selectedHistoryContent}
                compareEnabled={compareEnabled}
                changedSectionKeys={compareSummary.sections}
                lineDiffSummary={compareSummary.lines}
                sections={SPEC_SECTIONS}
              />

              <SpecHistoryDrawer
                open={historyOpen}
                onToggle={() => setHistoryOpen((prev) => !prev)}
                history={history}
                selectedPath={selectedHistory?.path || ''}
                onSelectItem={selectHistoryItem}
                compareEnabled={compareEnabled}
                onToggleCompare={() => setCompareEnabled((prev) => !prev)}
              />
            </section>
          </SplitPane>
        </div>

        {message ? <div className="builder-status">{message}</div> : null}
      </div>

      {approvalModalOpen && (
        <div className="spec-approval-backdrop">
          <div className="spec-approval-modal">
            <div className="spec-approval-header">
              <h4>Approve Spec</h4>
              <button type="button" className="msg-action-btn ui-btn" onClick={closeApprovalModal}>
                Close
              </button>
            </div>

            {approvalStep === 1 && (
              <div className="spec-approval-step">
                <p>
                  Approval marks this spec as implementation-ready and allows build actions to proceed in the workflow.
                </p>
                <div className="spec-approval-summary-grid">
                  <div className="spec-approval-card">
                    <strong>Completeness</strong>
                    <span>{completeness.percent}%</span>
                  </div>
                  <div className="spec-approval-card">
                    <strong>Sections changed</strong>
                    <span>{changedSections.length}</span>
                  </div>
                </div>

                {completeness.percent < APPROVAL_MIN_COMPLETENESS ? (
                  <div className="spec-approval-blocked">
                    <strong>Approval blocked</strong>
                    <span>
                      Completeness must be at least {APPROVAL_MIN_COMPLETENESS}%. Fill missing sections first.
                    </span>
                    <div className="spec-meter-jumps">
                      {completeness.missing.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className="msg-action-btn ui-btn"
                          onClick={() => {
                            closeApprovalModal();
                            jumpToSection(key);
                          }}
                        >
                          Jump to {SPEC_SECTIONS.find((section) => section.key === key)?.title || key}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="spec-approval-actions">
                  <button
                    type="button"
                    className="control-btn ui-btn ui-btn-primary"
                    onClick={() => setApprovalStep(2)}
                    disabled={completeness.percent < APPROVAL_MIN_COMPLETENESS}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {approvalStep === 2 && (
              <div className="spec-approval-step">
                <p>Type <code>APPROVE SPEC</code> to confirm final approval.</p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder="APPROVE SPEC"
                />
                <div className="spec-approval-actions">
                  <button type="button" className="control-btn ui-btn" onClick={() => setApprovalStep(1)}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="control-btn ui-btn ui-btn-primary"
                    onClick={runApprove}
                    disabled={approving}
                  >
                    {approving ? 'Approving…' : 'Approve Spec'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
