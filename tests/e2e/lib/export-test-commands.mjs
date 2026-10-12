// Explicit scenario migration adapter. Aliases are lexical to each test
// expression; they call the actual scoped commands with test metadata and never
// reinstall retired production globals or replace a renderer/format owner.
export function evaluateExport(page,expression) {
  if(typeof expression!=='string')return page.evaluate(expression);
  return page.evaluate(`(() => {
    const exportHost=document.getElementById('compatibility-business-ports');
    const commands=exportHost.markdownEditorExportCommandPort;
    const exportTaskPort=exportHost.markdownEditorExportTaskPort,exportRequestPort=exportHost.markdownEditorExportRequestPort;
    const exportImagePort=exportHost.markdownEditorImageExportPort,exportPdfPort=exportHost.markdownEditorPdfExportPort;
    const exportWordPort=exportHost.markdownEditorWordExportPort,exportHtmlPort=exportHost.markdownEditorHtmlExportPort,exportMarkdownPort=exportHost.markdownEditorMarkdownExportPort;
    const exportPreviewCommandPort=exportHost.markdownEditorPreviewCommandPort;
    let currentImageRatio=document.querySelector('#export-image-modal .ratio-btn.active')?.dataset.ratio||'9:16';
    const metadata=()=>({name:filenameInput.value,directory:exportDirectory,imageOptions:{ratio:currentImageRatio,cropFit:document.getElementById('image-crop-fit').checked}});
    const invoke=action=>{const input=metadata();if(!['renderImage','saveImage'].includes(action))delete input.imageOptions;return commands.invoke(action,{input});};
    const exportFile=()=>invoke('exportMarkdown'),exportHTML=()=>invoke('exportHtml'),exportWord=()=>invoke('exportWord'),exportPDF=()=>invoke('exportPdf');
    const renderExportImagePreview=()=>invoke('renderImage'),downloadExportImage=()=>invoke('saveImage');
    const openExportImageModal=()=>commands.invoke('openImage'),closeExportImageModal=()=>commands.invoke('closeImage');
    const selectImageRatio=ratio=>{currentImageRatio=ratio;return commands.invoke('selectRatio',{ratio});};
    const beginExportTask=title=>{try{const task=exportTaskPort.begin(title);if(!task)showToast('当前导出正在生成文件，请稍候');return task;}catch(error){showToast('导出失败：'+(error?.message||String(error)));return null;}};
    const finishExportTask=(...args)=>{try{return exportTaskPort.finish(...args);}catch(error){showToast('导出清理失败：'+(error?.message||String(error)));return false;}};
    return (${expression});
  })()`);
}
