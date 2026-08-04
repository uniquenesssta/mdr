import { marked } from 'marked';
import 'katex/dist/katex.min.css';
import { autoRenderMathInElement, createMathPresentationApi, katexEngine } from '../rendering/math-presentation.js';

let mermaidPromise = null;
let domToImagePromise = null;

function loadVendor(operation, loader) {
  if (window.markdownEditorPerf?.measure) {
    return window.markdownEditorPerf.measure(operation, loader, { category: 'runtime.vendor' });
  }
  return loader();
}

function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (!mermaidPromise) {
    mermaidPromise = loadVendor('vendor.load-mermaid', () => import('mermaid'))
      .then(module => {
        window.mermaid = module.default || module;
        return window.mermaid;
      })
      .catch(error => {
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

function loadDomToImage() {
  if (window.domtoimage) return Promise.resolve(window.domtoimage);
  if (!domToImagePromise) {
    domToImagePromise = loadVendor('vendor.load-dom-to-image', () => import('dom-to-image-more'))
      .then(module => {
        window.domtoimage = module.default || module;
        return window.domtoimage;
      })
      .catch(error => {
        domToImagePromise = null;
        throw error;
      });
  }
  return domToImagePromise;
}

const mathPresentation = createMathPresentationApi();

window.marked = marked;
window.katex = katexEngine;
window.renderMathInElement = autoRenderMathInElement;
window.markdownEditorMath = mathPresentation;
window.markdownEditorVendors = {
  ...(window.markdownEditorVendors || {}),
  loadMermaid,
  loadDomToImage
};
