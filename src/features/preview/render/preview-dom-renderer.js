/**
 * Responsibility: Patch preview body/block DOM while preserving reusable nodes and render metadata.
 * Imports: None.
 * Exports: createPreviewDomRenderer().
 * State/side effects: Owns only DOM replacement/reordering under the injected preview root; returns geometry-invalidating facts to callers.
 * Lifecycle: patch operations reject after destroy(); no observers, timers, scrolling or synchronization are owned here.
 */
function hashMarkup(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function assignRenderKeys(body) {
  const occurrences = new Map();
  for (const node of Array.from(body?.children || [])) {
    const markup = String(node?.outerHTML || '');
    const base = String(node?.tagName || 'NODE') + ':' + markup.length + ':' + hashMarkup(markup);
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    node.dataset ??= {};
    node.dataset.renderKey = base + ':' + occurrence;
  }
}

export function createPreviewDomRenderer({ root, documentRef, blockView } = {}) {
  if (!root || typeof root.querySelector !== 'function' || typeof root.replaceChildren !== 'function') {
    throw new TypeError('Preview DOM Renderer requires a preview root.');
  }
  if (!documentRef || typeof documentRef.createElement !== 'function') {
    throw new TypeError('Preview DOM Renderer requires documentRef.');
  }
  if (!blockView || typeof blockView.createNodes !== 'function' || typeof blockView.applySourceRange !== 'function') {
    throw new TypeError('Preview DOM Renderer requires Preview Block View.');
  }
  let destroyed = false;
  const assertActive = () => {
    if (destroyed) throw new Error('Preview DOM Renderer is destroyed.');
  };

  return Object.freeze({
    patchHtml(html, { forceFullRebuild = false } = {}) {
      assertActive();
      const template = documentRef.createElement('template');
      template.innerHTML = '<div class="markdown-body">' + String(html || '') + '</div>';
      const nextBody = template.content?.firstElementChild;
      if (!nextBody) throw new Error('Preview DOM Renderer could not create markdown body.');
      assignRenderKeys(nextBody);
      const currentBody = root.querySelector('.markdown-body');
      if (!currentBody || currentBody.classList?.contains?.('preview-loading')) {
        root.replaceChildren(nextBody);
        return {
          body: nextBody,
          changedNodes: Array.from(nextBody.children || []),
          reused: 0,
          bodyReplaced: true,
          anchors: []
        };
      }
      if (forceFullRebuild) {
        const changedNodes = Array.from(nextBody.children || []);
        currentBody.replaceChildren(...changedNodes);
        return { body: currentBody, changedNodes, reused: 0, bodyReplaced: false, anchors: [] };
      }

      const oldChildren = Array.from(currentBody.children || []);
      const buckets = new Map();
      for (const node of oldChildren) {
        const key = node.dataset?.renderKey || '';
        if (!key) continue;
        const bucket = buckets.get(key) || [];
        bucket.push(node);
        buckets.set(key, bucket);
      }

      const desiredNodes = [];
      const changedNodes = [];
      let reused = 0;
      for (const newNode of Array.from(nextBody.children || [])) {
        const key = newNode.dataset?.renderKey || '';
        const reusable = (key ? buckets.get(key) : null)?.shift?.();
        if (reusable) {
          desiredNodes.push(reusable);
          reused += 1;
        } else {
          desiredNodes.push(newNode);
          changedNodes.push(newNode);
        }
      }

      if (desiredNodes.length && reused / desiredNodes.length < 0.25) {
        currentBody.replaceChildren(...desiredNodes);
      } else {
        const used = new Set(desiredNodes);
        let cursor = currentBody.firstChild;
        for (const node of desiredNodes) {
          if (node === cursor) {
            cursor = cursor?.nextSibling || null;
            continue;
          }
          currentBody.insertBefore?.(node, cursor);
        }
        for (const node of oldChildren) {
          if (!used.has(node) && node.parentNode === currentBody) node.remove?.();
        }
      }
      return { body: currentBody, changedNodes, reused, bodyReplaced: false, anchors: [] };
    },

    patchBlocks(result, { forceAll = false, renderFallback } = {}) {
      assertActive();
      let body = root.querySelector('.markdown-body');
      let bodyReplaced = false;
      if (!body || body.classList?.contains?.('preview-loading')) {
        body = documentRef.createElement('div');
        body.className = 'markdown-body';
        root.replaceChildren(body);
        bodyReplaced = true;
        forceAll = true;
      }

      const existingByBlock = new Map();
      for (const node of Array.from(body.children || [])) {
        const id = node.dataset?.previewBlockId;
        if (!id) continue;
        const bucket = existingByBlock.get(id) || [];
        bucket.push(node);
        existingByBlock.set(id, bucket);
      }
      for (const nodes of existingByBlock.values()) {
        nodes.sort((left, right) => Number(left.dataset?.previewNodeIndex || 0) - Number(right.dataset?.previewNodeIndex || 0));
      }

      const blocks = Array.isArray(result?.blocks) ? result.blocks : [];
      const changedIds = result?.changedIds instanceof Set
        ? result.changedIds
        : new Set(Array.from(result?.changedIds || []));
      const desiredNodes = [];
      const changedNodes = [];
      let reused = 0;
      for (const block of blocks) {
        const existing = existingByBlock.get(block.id) || [];
        const shouldRender = forceAll || changedIds.has(block.id) || !existing.length;
        const nodes = shouldRender ? blockView.createNodes(block, renderFallback) : existing;
        if (shouldRender) changedNodes.push(...nodes);
        else reused += nodes.length;
        blockView.applySourceRange(nodes, block);
        desiredNodes.push(...nodes);
      }

      const reuseRatio = desiredNodes.length ? reused / desiredNodes.length : 0;
      const shouldBulkReplace = forceAll || !result?.incremental || !desiredNodes.length || reuseRatio < 0.25;
      if (shouldBulkReplace && Array.from(body.childNodes || []).length && reuseRatio < 0.25) {
        const replacementBody = documentRef.createElement('div');
        replacementBody.className = 'markdown-body';
        replacementBody.append?.(...desiredNodes);
        root.replaceChildren(replacementBody);
        body = replacementBody;
        bodyReplaced = true;
      } else if (shouldBulkReplace) {
        body.replaceChildren?.(...desiredNodes);
      } else {
        const desiredSet = new Set(desiredNodes);
        let cursor = body.firstChild;
        for (const node of desiredNodes) {
          if (node === cursor) {
            cursor = cursor?.nextSibling || null;
            continue;
          }
          body.insertBefore?.(node, cursor);
        }
        for (const node of Array.from(body.childNodes || [])) {
          if (!desiredSet.has(node)) node.remove?.();
        }
      }

      return {
        body,
        changedNodes,
        reused,
        parsedChars: result?.parsedChars,
        mode: result?.incremental ? 'incremental' : result?.reason,
        bodyReplaced,
        anchors: desiredNodes.filter(node => Boolean(node.dataset?.sourceLine))
      };
    },
    destroy() {
      destroyed = true;
    }
  });
}
