const editorToolsCompatibilityHost = document.getElementById('compatibility-business-ports');
const editorToolsSettingsStorePort = editorToolsCompatibilityHost?.markdownEditorSettingsStorePort;
const editorToolsEditorControllerPort = editorToolsCompatibilityHost?.markdownEditorEditorControllerPort;
const editorToolsHistoryPort = editorToolsCompatibilityHost?.markdownEditorEditorHistoryPort;
const editorToolsCommandPort = editorToolsCompatibilityHost?.markdownEditorEditorCommandPort;
if (!editorToolsSettingsStorePort) throw new Error('Settings Store compatibility port is unavailable.');
if (!editorToolsEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');
if (!editorToolsHistoryPort) throw new Error('Editor History compatibility port is unavailable.');
if (!editorToolsCommandPort) throw new Error('Editor Command compatibility port is unavailable.');

    // 清空文档
    function clearDoc() {
      if (confirm(t('confirmClear'))) {
        editorToolsEditorControllerPort.setText('');
        updatePreview();
        updateCount();
        saveToLocal();
      }
    }

    // 历史分组、撤销与重做只通过 Stage 5.9 History Adapter。
    function pushHistory() {
      editorToolsHistoryPort.isolate();
    }

    function undo() {
      if (!editorToolsHistoryPort.undo()) return;
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
      showToast(t('toastUndone'));
    }

    function redo() {
      if (!editorToolsHistoryPort.redo()) return;
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
      showToast(t('toastRedone'));
    }

    // 工具栏格式化
    function formatBold() {
      pushHistory();
      editorToolsCommandPort.bold();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function formatItalic() {
      pushHistory();
      editorToolsCommandPort.italic();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function formatUnderline() {
      pushHistory();
      wrapSelection('<u>', '</u>');
    }
    function formatStrikethrough() {
      pushHistory();
      editorToolsCommandPort.strikethrough();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function formatSubscript() {
      pushHistory();
      wrapSelection('<sub>', '</sub>');
    }
    function formatSuperscript() {
      pushHistory();
      wrapSelection('<sup>', '</sup>');
    }
    function insertCodeRow() {
      pushHistory();
      editorToolsCommandPort.inlineCode();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function insertCode() {
      pushHistory();
      editorToolsCommandPort.code();
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function wrapSelection(before, after) {
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = documentModel?.sliceText?.(start, end) ?? el.value.slice(start, end);
      el.setRangeText(before + selected + after, start, end, 'select');
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      el.focus();
    }

    const INLINE_COLOR_CONFIG = {
      text: {
        property: 'color',
        menuId: 'text-color-menu',
        buttonId: 'text-color-button',
        indicatorId: 'text-color-indicator',
        inputId: 'custom-text-color',
        label: '文字颜色'
      },
      highlight: {
        property: 'background-color',
        menuId: 'highlight-color-menu',
        buttonId: 'highlight-color-button',
        indicatorId: 'highlight-color-indicator',
        inputId: 'custom-highlight-color',
        label: '文字高亮'
      }
    };
    let inlineColorSelection = null;

    function getEditorSlice(start, end) {
      const el = getActiveEditor();
      return documentModel?.sliceText?.(start, end) ?? el.value.slice(start, end);
    }

    function captureInlineColorSelection() {
      const el = getActiveEditor();
      const start = Math.min(el.selectionStart || 0, el.selectionEnd || 0);
      const end = Math.max(el.selectionStart || 0, el.selectionEnd || 0);
      if (start === end) return null;
      return {
        start,
        end,
        documentLength: Number(el.textLength ?? el.value.length)
      };
    }

    function resolveInlineColorSelection() {
      const el = getActiveEditor();
      const length = Number(el.textLength ?? el.value.length);
      if (inlineColorSelection
        && inlineColorSelection.documentLength === length
        && inlineColorSelection.start >= 0
        && inlineColorSelection.end <= length
        && inlineColorSelection.start < inlineColorSelection.end) {
        return { ...inlineColorSelection };
      }
      return captureInlineColorSelection();
    }

    function updateInlineColorToolAvailability() {
      const selection = captureInlineColorSelection();
      const available = Boolean(selection) && !getActiveEditor().readOnly;
      Object.values(INLINE_COLOR_CONFIG).forEach(config => {
        const button = document.getElementById(config.buttonId);
        if (button) button.disabled = !available;
      });
      if (!available) inlineColorSelection = null;
    }

    function closeInlineColorMenus() {
      Object.values(INLINE_COLOR_CONFIG).forEach(config => {
        document.getElementById(config.menuId)?.classList.remove('show');
        document.getElementById(config.buttonId)?.setAttribute('aria-expanded', 'false');
      });
    }

    function toggleInlineColorMenu(kind) {
      const config = INLINE_COLOR_CONFIG[kind];
      if (!config) return;
      const selection = captureInlineColorSelection();
      if (!selection) {
        showToast('请先选择需要设置颜色的文字');
        return;
      }
      inlineColorSelection = selection;
      const menu = document.getElementById(config.menuId);
      const button = document.getElementById(config.buttonId);
      const willShow = !menu?.classList.contains('show');
      closeInlineColorMenus();
      if (!willShow || !menu) return;
      menu.classList.add('show');
      button?.setAttribute('aria-expanded', 'true');
    }

    function parseInlineColorStyles(styleText) {
      const styles = {};
      String(styleText || '').split(';').forEach(declaration => {
        const separator = declaration.indexOf(':');
        if (separator < 0) return;
        const property = declaration.slice(0, separator).trim().toLowerCase();
        const value = normalizeSettingColor(declaration.slice(separator + 1).trim());
        if (!value) return;
        if (property === 'color') styles.color = value;
        if (property === 'background' || property === 'background-color') styles['background-color'] = value;
      });
      return styles;
    }

    function findInlineColorChain(start, end) {
      const beforeStart = Math.max(0, start - 512);
      const before = getEditorSlice(beforeStart, start);
      const documentLength = Number(getActiveEditor().textLength ?? end + 64);
      const after = getEditorSlice(end, Math.min(documentLength, end + 64));
      const chainMatch = before.match(/(?:<span\s+style="[^"]*">)+$/i);
      if (!chainMatch) return null;

      const openings = Array.from(chainMatch[0].matchAll(/<span\s+style="([^"]*)">/gi));
      if (!openings.length || !after.startsWith('</span>'.repeat(openings.length))) return null;
      const styles = {};
      openings.forEach(match => Object.assign(styles, parseInlineColorStyles(match[1])));
      if (!styles.color && !styles['background-color']) return null;
      return {
        start: start - chainMatch[0].length,
        end: end + (7 * openings.length),
        styles
      };
    }

    function buildInlineColorMarkup(styles, selected) {
      const declarations = [];
      if (styles.color) declarations.push(`color:${styles.color}`);
      if (styles['background-color']) declarations.push(`background-color:${styles['background-color']}`);
      if (!declarations.length) return { opening: '', value: selected };
      const opening = `<span style="${declarations.join(';')}">`;
      return { opening, value: opening + selected + '</span>' };
    }

    function commitInlineColorChange(kind, color, clear = false) {
      const config = INLINE_COLOR_CONFIG[kind];
      if (!config) return;
      const selection = resolveInlineColorSelection();
      if (!selection) {
        showToast('请先选择需要设置颜色的文字');
        closeInlineColorMenus();
        updateInlineColorToolAvailability();
        return;
      }

      const selected = getEditorSlice(selection.start, selection.end);
      if (!selected || !selected.trim()) {
        showToast('不能对空白选区设置颜色');
        return;
      }
      if (/\n\s*\n/.test(selected)) {
        showToast('文字颜色暂不跨段落应用，请分段选择');
        return;
      }

      const normalizedColor = clear ? '' : normalizeSettingColor(color);
      if (!clear && !normalizedColor) {
        showToast('颜色值无效');
        return;
      }

      const chain = findInlineColorChain(selection.start, selection.end);
      const styles = {};
      Object.assign(styles, chain?.styles || {});
      if (clear && !styles[config.property]) {
        showToast('当前选区没有可清除的' + config.label);
        return;
      }
      if (clear) delete styles[config.property];
      else styles[config.property] = normalizedColor;

      const el = getActiveEditor();
      const replaceStart = chain?.start ?? selection.start;
      const replaceEnd = chain?.end ?? selection.end;
      const markup = buildInlineColorMarkup(styles, selected);

      pushHistory();
      el.setRangeText(markup.value, replaceStart, replaceEnd, 'start');
      const innerStart = replaceStart + markup.opening.length;
      const innerEnd = innerStart + selected.length;
      const restoreHybridPreview = getLayoutMode() === 'hybrid';
      if (restoreHybridPreview) {
        // 混合模式下不保留大选区，否则选区覆盖到的所有块都会继续显示源码。
        el.setSelectionRange(innerEnd, innerEnd);
        inlineColorSelection = null;
      } else {
        el.setSelectionRange(innerStart, innerEnd);
        inlineColorSelection = {
          start: innerStart,
          end: innerEnd,
          documentLength: Number(el.textLength ?? 0)
        };
      }

      if (!clear) {
        document.getElementById(config.indicatorId)?.style.setProperty('--indicator-color', normalizedColor);
        const input = document.getElementById(config.inputId);
        if (input) input.value = normalizedColor;
      }

      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      closeInlineColorMenus();
      // 混合模式保持焦点在工具栏，使编辑器立即回到完整预览态；
      // 其他模式仍恢复编辑器焦点并保留原有连续格式化体验。
      if (getLayoutMode() !== 'hybrid') el.focus({ preventScroll: true });
      updateInlineColorToolAvailability();
      showToast(clear ? '已清除' + config.label : '已应用' + config.label);
    }

    function applyInlineColor(kind, color) {
      commitInlineColorChange(kind, color, false);
    }

    function clearInlineColor(kind) {
      commitInlineColorChange(kind, '', true);
    }

    function formatQuote() {
      pushHistory();
      editorToolsCommandPort.quote(t('quote'));
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function finishBasicListCommand() {
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }

    function formatUnorderedList() {
      pushHistory();
      editorToolsCommandPort.unorderedList(t('unordered'));
      finishBasicListCommand();
    }
    function formatOrderedList() {
      pushHistory();
      editorToolsCommandPort.orderedList(t('unordered'));
      finishBasicListCommand();
    }
    function formatTaskList() {
      pushHistory();
      editorToolsCommandPort.taskList(t('unordered'));
      finishBasicListCommand();
    }
    function insertHeading(level) {
      pushHistory();
      editorToolsCommandPort.heading(level);
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      getActiveEditor().focus();
    }
    function toggleHeadingMenu() {
      document.getElementById('heading-menu').classList.toggle('show');
    }
    function closeHeadingMenu() {
      document.getElementById('heading-menu').classList.remove('show');
    }

    function getActiveEditor() {
      return editor;
    }

    function syncEditorFromActive() {
      if (!previewSource || previewSource.hidden) return;
      previewSource.value = editor.value;
    }

    let pendingLinkInsert = null;

    function insertLink() {
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = (documentModel?.sliceText?.(start, end) ?? el.value.slice(start, end)) || t('link');
      const modal = document.getElementById('link-modal');
      const input = document.getElementById('link-url-input');
      if (!modal || !input) {
        window.markdownEditorPerf?.diagnostic?.('editor.link-modal-missing', {
          category: 'content.operation',
          status: 'error',
          dedupeKey: 'editor.link-modal-missing',
          details: { modal: Boolean(modal), input: Boolean(input) }
        });
        showToast(t('promptLinkUrl'));
        return;
      }
      pendingLinkInsert = { start, end, selected };
      input.value = t('promptLinkDefault');
      const request = {
        options: {
          initialFocus: input,
          onClose: () => {
            pendingLinkInsert = null;
            editor.focus({ preventScroll: true });
          }
        }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
      requestAnimationFrame(() => input.select());
    }

    function closeLinkModal() {
      const modal = document.getElementById('link-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function confirmLinkInsert() {
      const pending = pendingLinkInsert;
      const input = document.getElementById('link-url-input');
      const url = String(input?.value || '').trim();
      if (!pending || !input) {
        closeLinkModal();
        return;
      }
      if (!url) {
        showToast(t('promptLinkUrl'));
        input.focus();
        return;
      }
      pushHistory();
      const el = getActiveEditor();
      el.setRangeText('[' + pending.selected + '](' + url + ')', pending.start, pending.end, 'end');
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      closeLinkModal();
    }

    function insertImageMarkdown(alt, url) {
      pushHistory();
      const safeAlt = String(alt).replace(/\]/g, '\\]');
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.setRangeText('![' + (safeAlt || t('image')) + '](' + url + ')', start, end, 'end');
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      el.focus();
    }

    const TABLE_GRID_ROWS = 8;
    const TABLE_GRID_COLS = 8;

    function initTableGrid() {
      const grid = document.getElementById('table-grid');
      if (!grid || grid.children.length) return;
      grid.innerHTML = '';
      for (let r = 1; r <= TABLE_GRID_ROWS; r++) {
        for (let c = 1; c <= TABLE_GRID_COLS; c++) {
          const cell = document.createElement('div');
          cell.className = 'table-grid-cell';
          cell.dataset.row = r;
          cell.dataset.col = c;
          grid.appendChild(cell);
        }
      }
      grid.addEventListener('mouseover', (e) => {
        if (!e.target.classList.contains('table-grid-cell')) return;
        highlightTableCells(parseInt(e.target.dataset.row), parseInt(e.target.dataset.col));
      });
      grid.addEventListener('click', (e) => {
        if (!e.target.classList.contains('table-grid-cell')) return;
        const rows = parseInt(e.target.dataset.row);
        const cols = parseInt(e.target.dataset.col);
        insertTable(rows, cols);
        closeTableMenu();
      });
      grid.addEventListener('mouseleave', () => {
        highlightTableCells(0, 0);
      });
    }

    function highlightTableCells(rows, cols) {
      document.querySelectorAll('.table-grid-cell').forEach(cell => {
        const r = parseInt(cell.dataset.row);
        const c = parseInt(cell.dataset.col);
        cell.classList.toggle('active', r <= rows && c <= cols);
      });
      const label = document.getElementById('table-size-label');
      if (label) label.textContent = t('tableSizeLabel', rows, cols);
    }

    function toggleTableMenu() {
      initTableGrid();
      highlightTableCells(0, 0);
      document.getElementById('table-menu').classList.toggle('show');
    }

    function closeTableMenu() {
      document.getElementById('table-menu').classList.remove('show');
    }

    function updateTableVisualEditingToggle() {
      const item = document.getElementById('table-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', tableVisualEditingEnabled);
      item.setAttribute('aria-checked', tableVisualEditingEnabled ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = tableVisualEditingEnabled ? '开' : '关';
    }

    function applyTableVisualEditingSetting(options = {}) {
      const enabled = Boolean(tableVisualEditingEnabled);
      editor.virtualEditor?.setHybridTableVisualEditing?.(enabled);
      updateTableVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('tableVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '表格深度可视化编辑已开启：双击单元格直接编辑，也可点击“编辑源码”切换源码'
          : '表格深度可视化编辑已关闭：恢复为只读展示与源码切换');
      }
      return enabled;
    }

    function toggleTableVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !tableVisualEditingEnabled;
      try {
        editorToolsSettingsStorePort.set('tableVisualEditing', nextEnabled);
      } catch (error) {
        showToast('表格可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      tableVisualEditingEnabled = nextEnabled;
      applyTableVisualEditingSetting({ persist: false });
    }

    function updateCodeVisualEditingToggle() {
      const item = document.getElementById('code-visual-editing-toggle');
      if (!item) return;
      item.classList.toggle('active', codeVisualEditingEnabled);
      item.setAttribute('aria-checked', codeVisualEditingEnabled ? 'true' : 'false');
      const state = item.querySelector('.menu-inline-switch-state');
      if (state) state.textContent = codeVisualEditingEnabled ? '开' : '关';
    }

    function applyCodeVisualEditingSetting(options = {}) {
      const enabled = Boolean(codeVisualEditingEnabled);
      editor.virtualEditor?.setHybridCodeVisualEditing?.(enabled);
      updateCodeVisualEditingToggle();
      if (options.persist !== false) {
        editorToolsSettingsStorePort.set('codeVisualEditing', enabled);
      }
      if (options.notify !== false) {
        showToast(enabled
          ? '代码块深度可视化编辑已开启：双击有语言或无语言代码块直接编辑'
          : '代码块深度可视化编辑已关闭：恢复为高亮展示与源码切换');
      }
      return enabled;
    }

    function toggleCodeVisualEditing(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const nextEnabled = !codeVisualEditingEnabled;
      try {
        editorToolsSettingsStorePort.set('codeVisualEditing', nextEnabled);
      } catch (error) {
        showToast('代码块可视化编辑设置保存失败：' + (error?.message || String(error)));
        return;
      }
      codeVisualEditingEnabled = nextEnabled;
      applyCodeVisualEditingSetting({ persist: false });
    }

    function insertInlineMath() {
      pushHistory();
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = documentModel?.sliceText?.(start, end) ?? el.value.slice(start, end);
      const formula = String(selected || 'E = mc^2').replace(/\s*\n\s*/g, ' ').trim();
      const insert = `$${formula}$`;
      el.setRangeText(insert, start, end, 'end');
      el.setSelectionRange(start + 1, start + 1 + formula.length);
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      el.focus();
    }

    function insertBlockMath() {
      pushHistory();
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = documentModel?.sliceText?.(start, end) ?? el.value.slice(start, end);
      const formula = String(selected || '\\int_{a}^{b} f(x)\\,dx').trim();
      const documentLength = Number(el.textLength ?? el.value.length ?? 0);
      const previous = start > 0 ? (documentModel?.sliceText?.(start - 1, start) ?? el.value.slice(start - 1, start)) : '';
      const next = end < documentLength ? (documentModel?.sliceText?.(end, end + 1) ?? el.value.slice(end, end + 1)) : '';
      const prefix = start > 0 && previous !== '\n' ? '\n' : '';
      const suffix = end < documentLength && next !== '\n' ? '\n' : '';
      const insert = `${prefix}$$\n${formula}\n$$${suffix}`;
      el.setRangeText(insert, start, end, 'end');
      const formulaStart = start + prefix.length + 3;
      el.setSelectionRange(formulaStart, formulaStart + formula.length);
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      el.focus();
    }

    function insertTable(rows, cols) {
      if (!rows || !cols) return;
      pushHistory();
      const headerCols = Array.from({ length: cols }, (_, i) => ' 列' + (i + 1) + ' ').join('|');
      const separator = '|' + Array.from({ length: cols }, () => ' --- ').join('|') + '|';
      const dataCols = '|' + Array.from({ length: cols }, () => ' 内容 ').join('|') + '|';
      let table = '\n|' + headerCols + '|\n' + separator;
      for (let r = 2; r <= rows; r++) {
        table += '\n' + dataCols;
      }
      table += '\n';
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.setRangeText(table, start, end, 'end');
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      el.focus();
    }

    // 图片上传模态框
    let pendingImageDataUrl = '';

    function openImageModal() {
      pendingImageDataUrl = '';
      document.getElementById('image-url-input').value = '';
      document.getElementById('image-url-alt').value = '';
      document.getElementById('image-upload-alt').value = '';
      document.getElementById('image-upload-preview').innerHTML = '';
      document.getElementById('image-file-input').value = '';
      switchImageTab('url');
      const modal = document.getElementById('image-modal');
      const request = {
        options: {
          initialFocus: document.getElementById('image-url-input'),
          onClose: () => { pendingImageDataUrl = ''; }
        }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
    }

    function closeImageModal() {
      const modal = document.getElementById('image-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function switchImageTab(tab) {
      document.querySelectorAll('.image-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.image-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === 'image-tab-' + tab);
      });
    }

    function handleImageFileSelect(input) {
      const file = input.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast(t('toastSelectImageFile'));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast(t('toastImageTooLarge'));
        pendingImageDataUrl = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        if (!confirm(t('imageLargeWarning', (file.size / 1024 / 1024).toFixed(1)))) {
          pendingImageDataUrl = '';
          return;
        }
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        pendingImageDataUrl = e.target.result;
        document.getElementById('image-upload-preview').innerHTML = '<img src="' + pendingImageDataUrl + '" alt="' + t('exportImagePreviewAlt') + '" >';
        switchImageTab('upload');
      };
      reader.onerror = () => showToast(t('toastImageReadFailed'));
      reader.readAsDataURL(file);
    }

    function confirmImageInsert() {
      const activeTab = document.querySelector('.image-tab.active').dataset.tab;
      let url = '';
      let alt = '';
      if (activeTab === 'url') {
        url = document.getElementById('image-url-input').value.trim();
        alt = document.getElementById('image-url-alt').value.trim();
        if (!url) {
          showToast(t('toastEnterImageUrl'));
          return;
        }
      } else {
        url = pendingImageDataUrl;
        alt = document.getElementById('image-upload-alt').value.trim();
        if (!url) {
          showToast(t('toastSelectImageFirst'));
          return;
        }
      }
      insertImageMarkdown(alt || t('image'), url);
      closeImageModal();
    }

    // Mermaid 图表
    const MERMAID_TEMPLATES = {
      mindmap: `mindmap\n  root((主题))\n    子主题 A\n      子节点 A1\n      子节点 A2\n    子主题 B\n      子节点 B1`,
      flowchart: `flowchart TD\n    A[开始] --> B{判断}\n    B -->|是| C[执行]\n    B -->|否| D[结束]`
    };

    function openMermaidModal() {
      document.getElementById('mermaid-type').value = 'mindmap';
      updateMermaidTemplate();
      const modal = document.getElementById('mermaid-modal');
      const request = { options: { initialFocus: document.getElementById('mermaid-code') } };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
    }

    function closeMermaidModal() {
      const modal = document.getElementById('mermaid-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function updateMermaidTemplate() {
      const type = document.getElementById('mermaid-type').value;
      document.getElementById('mermaid-code').value = MERMAID_TEMPLATES[type] || MERMAID_TEMPLATES.mindmap;
    }

    function confirmMermaidInsert() {
      const code = document.getElementById('mermaid-code').value.trim();
      if (!code) {
        showToast(t('toastMermaidEmpty'));
        return;
      }
      pushHistory();
      const el = getActiveEditor();
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const fenced = '\n```mermaid\n' + code + '\n```\n\n';
      el.setRangeText(fenced, start, end, 'end');
      syncEditorFromActive();
      updatePreview();
      updateCount();
      autoSave();
      closeMermaidModal();
      showToast(t('toastMermaidInserted'));
    }

    function collectMermaidCodeBlocks(roots) {
      const blocks = [];
      const seen = new Set();
      const add = code => {
        if (!(code instanceof HTMLElement) || seen.has(code)) return;
        const pre = code.closest('pre');
        if (!(pre instanceof HTMLPreElement) || pre.dataset.mermaidRendering === 'true') return;
        seen.add(code);
        blocks.push(code);
      };
      const searchRoots = Array.isArray(roots) && roots.length ? roots : [preview];
      searchRoots.forEach(root => {
        if (!(root instanceof Element)) return;
        if (root.matches('code.language-mermaid')) add(root);
        if (root.matches('pre')) add(root.querySelector(':scope > code.language-mermaid'));
        root.querySelectorAll?.('pre > code.language-mermaid').forEach(add);
      });
      return blocks;
    }

    function reportMermaidFailure(error, details = {}) {
      const message = error?.message || String(error || 'Mermaid render failed');
      console.error('Mermaid render error:', error);
      window.markdownEditorPerf?.diagnostic?.('preview.mermaid-render-failure', {
        category: 'render.pipeline',
        status: 'error',
        dedupeKey: `preview.mermaid-render-failure:${error?.name || 'Error'}:${details.sourceChars || 0}`,
        minIntervalMs: 3000,
        details: {
          ...details,
          message
        }
      });
    }

    async function renderMermaidBlocks(roots = null, isCancelled = () => false) {
      const presentation = window.markdownEditorPresentation?.mermaid;
      if (!presentation?.renderDiagram) return;
      if (isCancelled()) return;

      const theme = presentation.getTheme?.() || (document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'default');
      const blocks = collectMermaidCodeBlocks(roots);
      if (!blocks.length) return;
      let rendered = 0;
      let failed = 0;
      let cancelled = 0;

      for (const code of blocks) {
        if (isCancelled()) {
          cancelled += 1;
          break;
        }
        const pre = code.closest('pre');
        const source = String(code.textContent || '').trim();
        if (!(pre instanceof HTMLPreElement) || !source) continue;
        pre.dataset.mermaidRendering = 'true';
        pre.classList.remove('preview-mermaid-error');
        delete pre.dataset.mermaidError;

        const container = document.createElement('div');
        container.className = 'mermaid';
        for (const attribute of Array.from(pre.attributes)) {
          if (attribute.name.startsWith('data-') && attribute.name !== 'data-mermaid-rendering') {
            container.setAttribute(attribute.name, attribute.value);
          }
        }

        try {
          const sourceIdentity = Number(pre.dataset.sourceStartIndex);
          const cacheKey = Number.isFinite(sourceIdentity)
            ? `preview:${sourceIdentity}`
            : `preview-line:${Number(pre.dataset.sourceLine) || 0}`;
          const result = await presentation.renderDiagram(container, source, {
            theme,
            cacheKey,
            renderIdPrefix: 'markdown-editor-preview-mermaid',
            ariaLabel: 'Mermaid 图表',
            isCancelled: () => isCancelled() || !pre.isConnected
          });
          if (result.status === 'cancelled' || isCancelled() || !pre.isConnected) {
            delete pre.dataset.mermaidRendering;
            cancelled += 1;
            continue;
          }
          pre.replaceWith(container);
          rendered += 1;
        } catch (error) {
          delete pre.dataset.mermaidRendering;
          pre.classList.add('preview-mermaid-error');
          pre.dataset.mermaidError = 'true';
          failed += 1;
          reportMermaidFailure(error, {
            phase: 'render',
            sourceChars: source.length,
            sourceLine: Number(pre.dataset.sourceLine) || null
          });
        }
      }

      window.markdownEditorPerf?.record?.('preview.mermaid-render-result', {
        category: 'render.pipeline',
        durationMs: null,
        aggregate: true,
        details: { requested: blocks.length, rendered, failed, cancelled, renderer: 'shared' }
      });
    }

    // 视图布局与全屏
    function getLayoutMode() {
      return editorToolsSettingsStorePort.get('layoutMode');
    }

    function isHybridLayoutMode() {
      return getLayoutMode() === 'hybrid';
    }

    function applyEditorPresentationMode(mode) {
      const hybrid = mode === 'hybrid' && Boolean(editor.virtualEditor?.setPresentationMode);
      document.body.classList.toggle('hybrid-view-mode', hybrid);
      editor.virtualEditor?.setPresentationMode?.(hybrid ? 'hybrid' : 'source');
      const actualMode = editor.virtualEditor?.getPresentationMode?.() || 'source';
      if (actualMode !== (hybrid ? 'hybrid' : 'source')) {
        window.markdownEditorPerf?.diagnostic?.('hybrid.presentation-mode-mismatch', {
          category: 'editor.hybrid',
          status: 'error',
          dedupeKey: 'hybrid.presentation-mode-mismatch',
          minIntervalMs: 5000,
          details: {
            requestedMode: hybrid ? 'hybrid' : 'source',
            actualMode,
            layoutMode: mode,
            documentVersion: documentModel?.getDocumentVersion?.() || 0
          }
        });
      }
      const badge = document.getElementById('editor-presentation-badge');
      if (badge) {
        badge.hidden = !hybrid;
        badge.textContent = t('viewHybrid');
      }
      if (hybrid) suspendPreviewForHybridMode?.();
      return hybrid;
    }

    function setLayoutMode(mode, animate = document.documentElement.classList.contains('app-ready'), persist = true) {
      const previousMode = getLayoutMode();
      const previewWasHidden = previewCollapsed || previousMode === 'hybrid';
      let nextMode = ['both', 'hybrid', 'edit', 'preview'].includes(mode) ? mode : 'both';
      if (nextMode === 'hybrid' && !editor.virtualEditor?.setPresentationMode) nextMode = 'edit';
      if (persist) editorToolsSettingsStorePort.set('layoutMode', nextMode);

      if (nextMode === 'edit' || nextMode === 'hybrid') {
        editorCollapsed = false;
        previewCollapsed = true;
      } else if (nextMode === 'preview') {
        editorCollapsed = true;
        previewCollapsed = false;
        if (previewMode !== 'preview') setPreviewMode('preview');
      } else {
        editorCollapsed = false;
        previewCollapsed = false;
      }

      reconcileCompactSplitLayout?.(nextMode, {
        apply: false,
        resetPane: previousMode !== 'both' && nextMode === 'both'
      });

      localStorage.setItem(EDITOR_COLLAPSED_KEY, editorCollapsed ? 'true' : 'false');
      localStorage.setItem(PREVIEW_COLLAPSED_KEY, previewCollapsed ? 'true' : 'false');
      updateViewMenuLabel();

      const commit = () => {
        applyEditorPresentationMode(nextMode);
        applyPaneStates(true);
      };
      const involvesHybridMode = previousMode === 'hybrid' || nextMode === 'hybrid';
      const documentLength = documentModel?.getTextLength?.() ?? editor.textLength;
      const shouldAnimate = animate && !involvesHybridMode && documentLength < LARGE_DOCUMENT_CHARS;
      if (shouldAnimate) runLayoutTransition(commit, 'panes');
      else commit();

      if (nextMode === 'hybrid') {
        schedulePreviewUpdate();
      } else if (!previewCollapsed) {
        const previewBody = preview.querySelector('.markdown-body');
        refreshPreviewAfterLayout?.({
          forceRender: previewWasHidden
            || !previewBody
            || previewBody.classList.contains('preview-loading')
            || previewBody.childElementCount === 0,
          reason: `layout:${previousMode}->${nextMode}`
        });
      }
      window.markdownEditorPerf?.record('layout.mode-change', {
        category: 'ui.layout',
        durationMs: 0,
        details: {
          previousMode,
          nextMode,
          presentation: nextMode === 'hybrid' ? 'hybrid' : 'source',
          animated: shouldAnimate,
          documentLength
        }
      });
    }

    function toggleViewMenu() {
      document.getElementById('view-menu').classList.toggle('show');
    }
    function closeViewMenu() {
      document.getElementById('view-menu').classList.remove('show');
    }
    function updateViewMenuLabel() {
      const mode = getLayoutMode();
      const labels = { both: t('view'), hybrid: t('viewHybrid'), edit: t('viewEdit'), preview: t('viewPreview') };
      const btn = document.querySelector('#view-dropdown > button');
      if (btn) btn.innerHTML = (labels[mode] || t('view')) + ' ▾';
    }

    function togglePageFullscreen() {
      const app = document.querySelector('.app');
      app.classList.toggle('page-fullscreen');
      app.classList.toggle('is-page-fullscreen');
      const isActive = app.classList.contains('is-page-fullscreen');
      document.body.classList.toggle('page-fullscreen-active', isActive);
      document.body.classList.toggle('is-page-fullscreen-active', isActive);
      localStorage.setItem(PAGE_FULLSCREEN_KEY, isActive ? 'true' : 'false');
      showToast(isActive ? '专注模式已开启：已隐藏工具栏、侧边栏和状态栏' : '专注模式已关闭');
    }

    function toggleFullscreen() {
      if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) {
        showToast(t('toastNoFullscreenApi'));
        return;
      }
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      }
    }

    function onFullscreenChange() {
      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      // Optionally update toolbar state here in the future
    }

    // 网页转 Markdown 模态框
