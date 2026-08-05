    function openUrlModal() {
      document.getElementById('url-input').value = '';
      document.getElementById('url-status').textContent = '';
      document.getElementById('url-status').style.color = 'var(--color-text-muted)';
      document.getElementById('manual-area').style.display = 'none';
      document.getElementById('manual-html').value = '';
      document.getElementById('use-local-proxy').checked = Boolean(window.markdownEditorNative?.isAvailable);
      document.getElementById('proxy-url').style.display = 'none';
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

    // 查找与替换
    let findIndex = 0;

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

    async function findNext() {
      const query = document.getElementById('find-input').value;
      const status = document.getElementById('find-status');
      const el = getActiveEditor();
      if (!query) {
        status.textContent = '';
        return;
      }
      let virtualMatch = null;
      const currentDoc = getCurrentDocument?.();
      const nativeStore = window.markdownEditorDocumentStore;
      const useNativeSearch = Boolean(
        currentDoc?.nativeBacked
        && nativeStore?.search
        && (documentModel?.getTextLength?.() ?? el.textLength ?? 0) >= ULTRA_LARGE_DOCUMENT_CHARS
      );
      let nativeSearchCompleted = false;
      if (useNativeSearch) {
        status.textContent = '正在后台查找…';
        try {
          await saveCurrentDocumentState(false, { waitForNative: true });
          virtualMatch = await nativeStore.search(currentDoc.id, query, findIndex, true);
          nativeSearchCompleted = true;
        } catch (error) {
          console.warn('Native document search fallback:', error);
        }
      }
      if (!nativeSearchCompleted) {
        virtualMatch = documentModel?.findText?.(query, findIndex, { wrap: true })
          || el.virtualEditor?.findText?.(query, findIndex, { wrap: true });
      }
      let pos = virtualMatch?.from ?? -1;
      if (pos < 0 && !el.virtualEditor) {
        const text = el.value;
        pos = text.indexOf(query, findIndex);
        if (pos === -1) pos = text.indexOf(query, 0);
      }
      if (pos === -1) {
        status.textContent = t('statusNoMatch');
        return;
      }
      findIndex = virtualMatch?.to ?? pos + query.length;
      el.setSelectionRange(pos, findIndex);
      el.focus();
      el.virtualEditor?.scrollPositionIntoView?.(pos, 'smooth', 0.45);
      if (activeResolvedPreviewMode === 'chapter') {
        updatePreview().then(() => syncEditorSelectionToPreview(true));
      } else {
        requestAnimationFrame(() => syncEditorSelectionToPreview(true));
      }
      status.textContent = t('statusFoundMatch');
    }

    function replaceOne() {
      const query = document.getElementById('find-input').value;
      const replacement = document.getElementById('replace-input').value;
      const status = document.getElementById('find-status');
      const el = getActiveEditor();
      if (!query) {
        status.textContent = '';
        return;
      }
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = documentModel
        ? documentModel.sliceText(start, end)
        : el.virtualEditor
          ? el.virtualEditor.sliceText(start, end)
          : el.value.slice(start, end);
      if (selected !== query) {
        findNext();
        return;
      }
      el.setRangeText(replacement, start, end, 'end');
      syncEditorFromActive();
      findIndex = start + replacement.length;
      updatePreview();
      updateCount();
      autoSave();
      findNext();
    }

    function replaceAll() {
      const query = document.getElementById('find-input').value;
      const replacement = document.getElementById('replace-input').value;
      const status = document.getElementById('find-status');
      const el = getActiveEditor();
      if (!query) {
        status.textContent = '';
        return;
      }
      let count = 0;
      if (documentModel?.replaceAllText || el.virtualEditor?.replaceAllText) {
        count = documentModel?.replaceAllText?.(query, replacement)
          ?? el.virtualEditor.replaceAllText(query, replacement);
      } else {
        const text = el.value;
        const parts = text.split(query);
        count = Math.max(0, parts.length - 1);
        if (count) el.value = parts.join(replacement);
      }
      if (count > 0) {
        syncEditorFromActive();
        findIndex = 0;
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

      if (window.markdownEditorNative?.isAvailable) {
        proxyInput.style.display = 'none';
        return;
      }

      proxyInput.style.display = checked ? 'block' : 'none';
    }

    async function fetchWithNativeBackend(url) {
      if (!window.markdownEditorNative?.isAvailable) return null;
      return window.markdownEditorNative.fetchUrl(url);
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
        status.style.color = 'var(--color-danger)';
        return;
      }

      status.textContent = t('urlStatusFetching');
      status.style.color = 'var(--color-text-muted)';
      fetchedHtml = '';

      // 桌面版优先使用 Rust 后端，不再依赖 Python 代理或公网 CORS 服务。
      if (window.markdownEditorNative?.isAvailable) {
        try {
          const data = await fetchWithNativeBackend(url);
          fetchedHtml = data?.html || data?.content || '';
          if (!fetchedHtml) throw new Error('Native backend returned empty content');
          status.textContent = t('urlStatusLocalSuccess');
          status.style.color = 'var(--color-accent)';
          manualArea.style.display = 'none';
          return;
        } catch (err) {
          status.innerHTML = t('urlStatusLocalFailed', err.message || String(err));
          status.style.color = 'var(--color-danger)';
          manualArea.style.display = 'block';
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
          status.style.color = 'var(--color-accent)';
          manualArea.style.display = 'none';
          return;
        } catch (err) {
          const hint = data?.hint ? data.hint : '';
          status.innerHTML = t('urlStatusLocalFailed', err.message) + (hint ? '<br><small>' + hint + '</small>' : '');
          status.style.color = 'var(--color-danger)';
          manualArea.style.display = 'block';
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
          status.style.color = 'var(--color-accent)';
          manualArea.style.display = 'none';
          return;
        } catch (err) {
          lastError = err.message;
        }
      }

      status.textContent = t('urlStatusPublicFailed', lastError);
      status.style.color = 'var(--color-danger)';
      manualArea.style.display = 'block';
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
          else editor.value = markdown;
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
