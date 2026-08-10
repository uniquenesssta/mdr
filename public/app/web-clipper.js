    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');
    const webClipperPlatformPort = webClipperCompatibilityHost?.markdownEditorPlatformPort;
    const webClipperEditorControllerPort = webClipperCompatibilityHost?.markdownEditorEditorControllerPort;
    const webClipperEditorCommandPort = webClipperCompatibilityHost?.markdownEditorEditorCommandPort;
    if (!webClipperEditorControllerPort) throw new Error('Editor Controller compatibility port is unavailable.');
    if (!webClipperEditorCommandPort) throw new Error('Editor Command compatibility port is unavailable.');

    function setClipperHidden(element, hidden) {
      element?.classList.toggle('is-hidden', Boolean(hidden));
    }

    function setClipperStatusTone(element, tone = 'muted') {
      if (!element) return;
      element.classList.remove('is-muted', 'is-success', 'is-error');
      element.classList.add(tone === 'success' ? 'is-success' : tone === 'error' ? 'is-error' : 'is-muted');
    }

    function openUrlModal() {
      document.getElementById('url-input').value = '';
      document.getElementById('url-status').textContent = '';
      setClipperStatusTone(document.getElementById('url-status'), 'muted');
      setClipperHidden(document.getElementById('manual-area'), true);
      document.getElementById('manual-html').value = '';
      document.getElementById('use-local-proxy').checked = Boolean(webClipperPlatformPort?.supports('desktop.webFetch'));
      setClipperHidden(document.getElementById('proxy-url'), true);
      toggleProxyInput();
      fetchedHtml = '';
      const modal = document.getElementById('url-modal');
      const request = {
        options: {
          initialFocus: document.getElementById('url-input'),
          onClose: () => { fetchedHtml = ''; }
        }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
    }
    function closeUrlModal() {
      const modal = document.getElementById('url-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    // 查找与替换：Atomic 5.11 仅迁移业务命令；现有 modal wrapper 保留至 5.12。
    function openFindModal() {
      const findInput = document.getElementById('find-input');
      const ed = getActiveEditor();
      if (ed.selectionStart !== ed.selectionEnd) {
        findInput.value = documentModel
          ? documentModel.sliceText(ed.selectionStart, ed.selectionEnd)
          : ed.virtualEditor
            ? ed.virtualEditor.sliceText(ed.selectionStart, ed.selectionEnd)
            : ed.value.slice(ed.selectionStart, ed.selectionEnd);
      }
      document.getElementById('find-status').textContent = '';
      const modal = document.getElementById('find-modal');
      const request = {
        options: {
          initialFocus: findInput,
          onClose: () => { document.getElementById('find-status').textContent = ''; }
        }
      };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-open', { detail: request }));
      if (request.error) throw request.error;
      requestAnimationFrame(() => findInput.select());
    }

    function closeFindModal() {
      const modal = document.getElementById('find-modal');
      const request = { reason: 'feature-close' };
      modal.dispatchEvent(new CustomEvent('markdown-editor:modal-shell-close', { detail: request }));
      if (request.error) throw request.error;
    }

    function createFindSearchOptions(status) {
      const currentDoc = getCurrentDocument?.();
      const nativeStore = window.markdownEditorDocumentStore;
      const documentLength = documentModel?.getTextLength?.() ?? getActiveEditor().textLength ?? 0;
      const useNativeSearch = Boolean(
        currentDoc?.nativeBacked
        && nativeStore?.search
        && documentLength >= ULTRA_LARGE_DOCUMENT_CHARS
      );
      if (!useNativeSearch) return {};
      return {
        async nativeSearch({ query, from, wrap }) {
          status.textContent = '正在后台查找…';
          await saveCurrentDocumentState(false, { waitForNative: true });
          return nativeStore.search(currentDoc.id, query, from, wrap);
        },
        onNativeSearchError(error) {
          console.warn('Native document search fallback:', error);
        }
      };
    }

    function applyFindMatch(match, status) {
      if (!match) {
        status.textContent = t('statusNoMatch');
        return false;
      }
      const el = getActiveEditor();
      el.setSelectionRange(match.from, match.to);
      el.focus();
      el.virtualEditor?.scrollPositionIntoView?.(match.from, 'smooth', 0.45);
      if (activeResolvedPreviewMode === 'chapter') {
        updatePreview().then(() => syncEditorSelectionToPreview(true));
      } else {
        requestAnimationFrame(() => syncEditorSelectionToPreview(true));
      }
      status.textContent = t('statusFoundMatch');
      return true;
    }

    async function findNext() {
      const query = document.getElementById('find-input').value;
      const status = document.getElementById('find-status');
      if (!query) {
        status.textContent = '';
        return;
      }
      const match = await webClipperEditorCommandPort.findNext(query, createFindSearchOptions(status));
      applyFindMatch(match, status);
    }

    async function replaceOne() {
      const query = document.getElementById('find-input').value;
      const replacementText = document.getElementById('replace-input').value;
      const status = document.getElementById('find-status');
      if (!query) {
        status.textContent = '';
        return;
      }
      const result = await webClipperEditorCommandPort.replaceOne(
        query,
        replacementText,
        createFindSearchOptions(status)
      );
      if (result.replaced) {
        syncEditorFromActive();
        updatePreview();
        updateCount();
        autoSave();
      }
      applyFindMatch(result.match, status);
    }

    function replaceAll() {
      const query = document.getElementById('find-input').value;
      const replacementText = document.getElementById('replace-input').value;
      const status = document.getElementById('find-status');
      if (!query) {
        status.textContent = '';
        return;
      }
      const count = webClipperEditorCommandPort.replaceAll(query, replacementText);
      if (count > 0) {
        syncEditorFromActive();
        updatePreview();
        updateCount();
        autoSave();
      }
      status.textContent = count > 0 ? t('statusReplacedCount', count) : t('statusNoMatch');
    }

    function toggleProxyInput() {
      const checked = document.getElementById('use-local-proxy').checked;
      const proxyInput = document.getElementById('proxy-url');
      if (!proxyInput) return;

      if (webClipperPlatformPort?.supports('desktop.webFetch')) {
        setClipperHidden(proxyInput, true);
        return;
      }

      setClipperHidden(proxyInput, !checked);
    }

    async function fetchWithNativeBackend(url) {
      if (!webClipperPlatformPort?.supports('desktop.webFetch')) return null;
      return webClipperPlatformPort.call('web', 'fetchText', url);
    }

    // 尝试通过 Tauri Rust 后端、本地代理或公共 CORS 代理获取网页
    async function fetchUrl() {
      const urlInput = document.getElementById('url-input');
      const status = document.getElementById('url-status');
      const manualArea = document.getElementById('manual-area');
      const useLocalProxy = document.getElementById('use-local-proxy').checked;
      const proxyUrlInput = document.getElementById('proxy-url');
      const url = urlInput.value.trim();

      if (!url) {
        status.textContent = t('urlStatusEmptyUrl');
        setClipperStatusTone(status, 'error');
        return;
      }

      status.textContent = t('urlStatusFetching');
      setClipperStatusTone(status, 'muted');
      fetchedHtml = '';

      // 桌面版优先使用 Rust 后端，不再依赖 Python 代理或公网 CORS 服务。
      if (webClipperPlatformPort?.supports('desktop.webFetch')) {
        try {
          const data = await fetchWithNativeBackend(url);
          fetchedHtml = String(data || '');
          if (!fetchedHtml) throw new Error('Native backend returned empty content');
          status.textContent = t('urlStatusLocalSuccess');
          setClipperStatusTone(status, 'success');
          setClipperHidden(manualArea, true);
          return;
        } catch (err) {
          status.innerHTML = t('urlStatusLocalFailed', err.message || String(err));
          setClipperStatusTone(status, 'error');
          setClipperHidden(manualArea, false);
          return;
        }
      }

      // 浏览器预览模式保留本地 HTTP 代理 fallback。
      if (useLocalProxy) {
        const proxyUrl = (proxyUrlInput.value.trim() || 'http://localhost:8765/fetch') + '?url=' + encodeURIComponent(url);
        let data = null;
        try {
          const response = await fetch(proxyUrl);
          if (!response.ok) throw new Error('Local proxy response not ok');
          data = await response.json();
          if (data.success === false) {
            throw new Error(data.error || 'Unknown proxy error');
          }
          fetchedHtml = data.html || data.content || '';
          if (!fetchedHtml) throw new Error('Local proxy returned empty content');
          status.textContent = t('urlStatusLocalSuccess');
          setClipperStatusTone(status, 'success');
          setClipperHidden(manualArea, true);
          return;
        } catch (err) {
          const hint = data?.hint ? data.hint : '';
          status.innerHTML = t('urlStatusLocalFailed', err.message) + (hint ? '<br><small>' + hint + '</small>' : '');
          setClipperStatusTone(status, 'error');
          setClipperHidden(manualArea, false);
          return;
        }
      }

      // 公共代理 fallback
      const proxies = [
        { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), type: 'text' },
        { url: 'https://api.allorigins.win/get?url=' + encodeURIComponent(url), type: 'json', field: 'contents' },
        { url: 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), type: 'text' }
      ];

      let lastError = '';
      for (const proxy of proxies) {
        try {
          const response = await fetch(proxy.url);
          if (!response.ok) throw new Error('Proxy response not ok');
          let text;
          if (proxy.type === 'json') {
            const data = await response.json();
            text = data[proxy.field];
            // allorigins 有时返回 base64
            if (typeof text === 'string' && /^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0) {
              try { text = atob(text); } catch (e) {}
            }
          } else {
            text = await response.text();
          }
          if (!text || text.length < 100) throw new Error('Content too short');
          fetchedHtml = text;
          status.textContent = t('urlStatusPublicSuccess');
          setClipperStatusTone(status, 'success');
          setClipperHidden(manualArea, true);
          return;
        } catch (err) {
          lastError = err.message;
        }
      }

      status.textContent = t('urlStatusPublicFailed', lastError);
      setClipperStatusTone(status, 'error');
      setClipperHidden(manualArea, false);
    }

    // 提取网页元信息
    function extractMeta(doc) {
      const title = (doc.querySelector('title')?.textContent?.trim())
        || (doc.querySelector('h1')?.textContent?.trim())
        || '';
      const author = (doc.querySelector('meta[name="author"]')?.content?.trim())
        || (doc.querySelector('meta[property="article:author"]')?.content?.trim())
        || (doc.querySelector('[rel="author"]')?.textContent?.trim())
        || '';
      let published = (doc.querySelector('meta[property="article:published_time"]')?.content?.trim())
        || (doc.querySelector('meta[name="publishdate"]')?.content?.trim())
        || (doc.querySelector('meta[name="date"]')?.content?.trim())
        || (doc.querySelector('time')?.dateTime?.trim())
        || (doc.querySelector('time')?.textContent?.trim())
        || '';
      return { title, author, published };
    }

    // 提取主内容区域
    function extractMainContent(doc) {
      const selectors = ['article', '[role="main"]', '.post-content', '.entry-content', '.article-content', '.content', '#content', 'main'];
      for (const sel of selectors) {
        const el = doc.querySelector(sel);
        if (el) return el;
      }
      return doc.body;
    }

    // 清理无关元素
    function stripUnwantedElements(root) {
      const selectors = 'script, style, nav, aside, header, footer, form, iframe, img, svg, video, audio, canvas, .ad, .ads, .advertisement, .sidebar, .comments, .comment, #comments, [class*="ad-"], [class*="ads-"], [id*="ad-"], [class*="comment"], [id*="comment"]';
      root.querySelectorAll(selectors).forEach(el => el.remove());
      return root;
    }

    // 将提取的 HTML 转为 Markdown
    function htmlToMarkdown(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.replace(/\s+/g, ' ');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(htmlToMarkdown).join('');
      switch (tag) {
        case 'h1': return '# ' + children.trim() + '\n\n';
        case 'h2': return '## ' + children.trim() + '\n\n';
        case 'h3': return '### ' + children.trim() + '\n\n';
        case 'h4': return '#### ' + children.trim() + '\n\n';
        case 'h5': return '##### ' + children.trim() + '\n\n';
        case 'h6': return '###### ' + children.trim() + '\n\n';
        case 'p': return children.trim() + '\n\n';
        case 'br': return '\n';
        case 'a':
          const href = node.getAttribute('href') || '';
          return '[' + children + '](' + href + ')';
        case 'strong':
        case 'b': return '**' + children + '**';
        case 'em':
        case 'i': return '*' + children + '*';
        case 'code': return '`' + children + '`';
        case 'pre':
          const code = node.querySelector('code');
          if (code) {
            let lang = '';
            const cls = code.className || '';
            const m = cls.match(/language-(\w+)/);
            if (m) lang = m[1];
            return '\n```' + lang + '\n' + code.textContent.trim() + '\n```\n\n';
          }
          return '\n```\n' + children.trim() + '\n```\n\n';
        case 'ul':
          return Array.from(node.children).map(li => '- ' + htmlToMarkdown(li).trim()).join('\n') + '\n\n';
        case 'ol':
          return Array.from(node.children).map((li, idx) => (idx + 1) + '. ' + htmlToMarkdown(li).trim()).join('\n') + '\n\n';
        case 'li': return children.trim();
        case 'blockquote':
          return '> ' + children.trim().replace(/\n/g, '\n> ') + '\n\n';
        case 'hr': return '---\n\n';
        case 'table': return convertTable(node);
        case 'div': return children.trim() + '\n\n';
        case 'figure': return children.trim() + '\n\n';
        case 'section': return children.trim() + '\n\n';
        default: return children;
      }
    }

    function convertTable(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (!rows.length) return '';
      let md = '\n';
      rows.forEach((tr, i) => {
        const cells = Array.from(tr.querySelectorAll('td, th')).map(td => {
          return htmlToMarkdown(td).trim().replace(/\|/g, '\\|');
        });
        if (cells.length) {
          md += '| ' + cells.join(' | ') + ' |\n';
          if (i === 0) {
            md += '|' + cells.map(() => '---').join('|') + '|\n';
          }
        }
      });
      return md + '\n';
    }

    // 转换并插入到编辑器
    function convertAndInsert() {
      const manualHtml = document.getElementById('manual-html').value.trim();
      const html = fetchedHtml || manualHtml;
      if (!html) {
        showToast(t('toastNoContent'));
        return;
      }
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = extractMeta(doc);
        const main = extractMainContent(doc);
        const cleaned = stripUnwantedElements(main.cloneNode(true));
        let bodyMd = htmlToMarkdown(cleaned).replace(/\n{3,}/g, '\n\n').trim();

        // 避免 bodyMd 以 h1 开头与标题重复
        if (meta.title && bodyMd.toLowerCase().startsWith('# ' + meta.title.toLowerCase())) {
          bodyMd = bodyMd.replace(/^#\s+.+\n+/, '');
        }

        let markdown = '';
        if (meta.title) markdown += '# ' + meta.title + '\n\n';
        const metaParts = [];
        if (meta.author) metaParts.push('作者：' + meta.author);
        if (meta.published) metaParts.push('发布时间：' + meta.published);
        if (metaParts.length) markdown += '> ' + metaParts.join(' | ') + '\n\n';
        markdown += bodyMd;
        markdown = markdown.trim();

        if (!markdown) {
          showToast(t('toastExtractFailed'));
          return;
        }
        const currentLength = documentModel?.getTextLength?.() ?? editor.textLength;
        const isEmpty = documentModel
          ? documentModel.getNonWhitespaceCount() === 0
          : !editor.value.trim();
        if (isEmpty) {
          if (documentModel) documentModel.replaceRange(markdown, 0, currentLength, 'end');
          else webClipperEditorControllerPort.setText(markdown);
        } else if (documentModel) {
          documentModel.replaceRange('\n\n' + markdown, currentLength, currentLength, 'end');
        } else {
          editor.value += '\n\n' + markdown;
        }

        if (previewMode === 'source') {
          previewSource.value = editor.virtualEditor ? '' : editor.value;
        }
        updatePreview();
        updateCount();
        saveToLocal();
        closeUrlModal();
        showToast(t('toastInsertedMd'));
      } catch (err) {
        showToast(t('toastConvertFailed', err.message));
      }
    }

    // Toast 提示
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // 事件监听
