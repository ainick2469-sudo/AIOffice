export const PICKER_INJECTION_SCRIPT = `
(function () {
  if (window.__AI_OFFICE_PICKER__) return;

  var enabled = false;
  var outline = document.createElement('div');
  outline.id = '__ai_office_picker_outline__';
  outline.style.position = 'fixed';
  outline.style.border = '2px solid rgba(95, 141, 255, 0.95)';
  outline.style.background = 'rgba(95, 141, 255, 0.12)';
  outline.style.pointerEvents = 'none';
  outline.style.zIndex = '2147483647';
  outline.style.borderRadius = '4px';
  outline.style.display = 'none';
  document.documentElement.appendChild(outline);

  var lastTarget = null;

  function escapeCss(value) {
    return String(value || '').replace(/([:.#\\[\\],>+~])/g, '\\\\$1');
  }

  function buildPath(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var tag = String(node.tagName || '').toLowerCase();
      if (!tag) break;
      var part = tag;
      if (node.id) {
        part += '#' + escapeCss(node.id);
        parts.unshift(part);
        break;
      }

      var classes = String(node.className || '')
        .split(/\\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(escapeCss);
      if (classes.length) {
        part += '.' + classes.join('.');
      }

      if (node.parentElement) {
        var siblings = Array.prototype.filter.call(
          node.parentElement.children,
          function (child) {
            return child.tagName === node.tagName;
          }
        );
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }

      parts.unshift(part);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function selectPayload(target) {
    var text = String(target.innerText || target.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim()
      .slice(0, 80);
    var classes = String(target.className || '')
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 8);

    return {
      tag: String(target.tagName || '').toLowerCase(),
      id: target.id || '',
      classes: classes,
      text: text,
      path: buildPath(target),
    };
  }

  function placeOutline(target) {
    if (!target || !enabled) return;
    var rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    outline.style.display = 'block';
    outline.style.left = rect.left + 'px';
    outline.style.top = rect.top + 'px';
    outline.style.width = rect.width + 'px';
    outline.style.height = rect.height + 'px';
  }

  function hideOutline() {
    outline.style.display = 'none';
  }

  function onMove(event) {
    if (!enabled) return;
    var target = event.target;
    if (!target || target === outline || target === document.documentElement || target === document.body) return;
    lastTarget = target;
    placeOutline(target);
  }

  function onLeave() {
    if (!enabled) return;
    hideOutline();
    lastTarget = null;
  }

  function onClick(event) {
    if (!enabled) return;
    var target = event.target;
    if (!target || target === outline) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    lastTarget = target;
    placeOutline(target);
    window.parent.postMessage(
      { type: 'ai-office-preview-selection', payload: selectPayload(target) },
      '*'
    );
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseleave', onLeave, true);
  document.addEventListener('click', onClick, true);

  window.addEventListener('message', function (event) {
    if (!event || !event.data || event.data.type !== 'ai-office-design-mode') return;
    enabled = Boolean(event.data.enabled);
    if (!enabled) {
      hideOutline();
      lastTarget = null;
    } else if (lastTarget) {
      placeOutline(lastTarget);
    }
  });

  window.__AI_OFFICE_PICKER__ = {
    setEnabled: function (next) {
      enabled = Boolean(next);
      if (!enabled) {
        hideOutline();
      }
    },
  };
})();
`;
