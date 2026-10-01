    const webClipperCompatibilityHost = document.getElementById('compatibility-business-ports');
    const webClipperPlatformPort = webClipperCompatibilityHost?.markdownEditorPlatformPort;
    const webClipperFetchPort = webClipperCompatibilityHost?.markdownEditorWebFetchPort;
    if (!webClipperFetchPort) throw new Error('Web Fetch compatibility port is unavailable.');
    const webClipperEditorUiCommandPort = webClipperCompatibilityHost?.markdownEditorEditorUiCommandPort;
    const webClipperDocumentUiCommandPort = webClipperCompatibilityHost?.markdownEditorDocumentUiCommandPort;
const webClipperPreviewCommandPort = webClipperCompatibilityHost?.markdownEditorPreviewCommandPort;
    if (!webClipperEditorUiCommandPort) throw new Error('Editor UI command compatibility port is unavailable.');
    if (!webClipperDocumentUiCommandPort) throw new Error('Document UI command compatibility port is unavailable.');
if (!webClipperPreviewCommandPort) throw new Error('Preview Command compatibility port is unavailable.');
    webClipperEditorUiCommandPort.register({
      getFindSearchOptions: setStatus => createFindSearchOptions(setStatus),
      afterFindMatch: match => afterFindMatch(match)
    });
    webClipperDocumentUiCommandPort.register({ openWebClipper: () => openUrlModal() });

    function setClipperHidden(element, hidden) {
      element?.classList.toggle('is-hidden', Boolean(hidden));
    }

    function setClipperStatusTone(element, tone = 'muted') {
      if (!element) return;
      element.classList.remove('is-muted', 'is-success', 'is-error');
      element.classList.add(tone === 'success' ? 'is-success' : tone === 'error' ? 'is-error' : 'is-muted');
    }

    webClipperFetchPort.watchInputs(['url-input', 'proxy-url', 'use-local-proxy', 'manual-html'].map(id => document.getElementById(id)), () => {
      fetchedHtml = '';
      document.getElementById('url-status').textContent = '';
      setClipperStatusTone(document.getElementById('url-status'), 'muted');
    });

    function openUrlModal() {
      webClipperFetchPort.cancel();
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
          onClose: () => { webClipperFetchPort.cancel(); fetchedHtml = ''; }
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

    // Atomic 5.12：Find/Replace 对话框已迁移，classic 只保留 native 搜索与预览同步桥。
    function createFindSearchOptions(setStatus = () => {}) {
      const currentDoc = getCurrentDocument?.();
      const nativeStore = window.markdownEditorDocumentStore;
      const documentLength = documentModel.getTextLength();
      const useNativeSearch = Boolean(
        currentDoc?.nativeBacked
        && nativeStore?.search
        && documentLength >= ULTRA_LARGE_DOCUMENT_CHARS
      );
      if (!useNativeSearch) return {};
      return {
        async nativeSearch({ query, from, wrap }) {
          setStatus('正在后台查找…');
          await saveCurrentDocumentState(false, { waitForNative: true });
          return nativeStore.search(currentDoc.id, query, from, wrap);
        },
        onNativeSearchError(error) {
          console.warn('Native document search fallback:', error);
        }
      };
    }

    function afterFindMatch(match) {
      if (!match) return false;
      if (webClipperPreviewCommandPort.snapshot.mode === 'chapter') {
        webClipperPreviewCommandPort.update().then(() => {
          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        });
      } else {
        requestAnimationFrame(() => {
          if (webClipperEditorUiCommandPort.has('syncEditorSelectionToPreview')) {
            webClipperEditorUiCommandPort.invoke('syncEditorSelectionToPreview', true, 'find-match');
          }
        });
      }
      return true;
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

    // UI only: source routing, cancellation and request generations belong to Import.
    async function fetchUrl() {
      const status = document.getElementById('url-status');
      const manualArea = document.getElementById('manual-area');
      fetchedHtml = '';
      status.textContent = t('urlStatusFetching');
      setClipperStatusTone(status, 'muted');
      const result = await webClipperFetchPort.fetchUrl(document.getElementById('url-input').value, {
        useLocalProxy: document.getElementById('use-local-proxy').checked,
        proxyUrl: document.getElementById('proxy-url').value
      });
      if (!webClipperFetchPort.isCurrent(result)) return;
      if (result.status === 'empty') {
        status.textContent = t('urlStatusEmptyUrl');
        setClipperStatusTone(status, 'error');
        return;
      }
      if (result.status === 'success') {
        fetchedHtml = result.html;
        status.textContent = t(result.source === 'public-proxy' ? 'urlStatusPublicSuccess' : 'urlStatusLocalSuccess');
        setClipperStatusTone(status, 'success');
        setClipperHidden(manualArea, true);
        return;
      }
      status.textContent = t(result.source === 'public-proxy' ? 'urlStatusPublicFailed' : 'urlStatusLocalFailed', result.error)
        + (result.hint ? '\n' + result.hint : '');
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
      const html = fetchedHtml || webClipperFetchPort.manualHtml(manualHtml).html;
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
        const currentLength = documentModel.getTextLength();
        const isEmpty = documentModel.getNonWhitespaceCount() === 0;
        if (isEmpty) {
          documentModel.replaceRange(markdown, 0, currentLength, 'end');
        } else {
          documentModel.replaceRange('\n\n' + markdown, currentLength, currentLength, 'end');
        }
        webClipperPreviewCommandPort.update();
        webClipperPreviewCommandPort.updateCount();
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
