import {
  buildHybridMarkdownDecorations,
  createHybridMarkdownControllerExtension,
  getHybridMarkdownStats,
  hybridCodeVisualEditingFacet,
  hybridTableVisualEditingFacet
} from './hybrid/controller.js';

export { buildHybridMarkdownDecorations, getHybridMarkdownStats };

export function createHybridMarkdownExtension() {
  return createHybridMarkdownControllerExtension();
}

export function createHybridMarkdownConfiguration(options = {}) {
  return [
    hybridTableVisualEditingFacet.of(Boolean(options.tableVisualEditing)),
    hybridCodeVisualEditingFacet.of(Boolean(options.codeVisualEditing))
  ];
}
