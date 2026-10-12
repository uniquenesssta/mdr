import { ExportCancelledError, isExportCancelledError } from '../task/export-cancellation.js';

const formats = Object.freeze({ exportMarkdown:'markdown', exportHtml:'html', exportWord:'word', exportPdf:'pdf', renderImage:'image', saveImage:'image' });
const successKeys = Object.freeze({exportMarkdown:'toastExported',exportHtml:'toastHtmlExported',exportWord:'toastWordExported',renderImage:'toastPreviewGenerated',saveImage:'toastImageDownloaded'});

/** Owns command validation/result notifications and terminal command lifetime.
 * Format owners retain source/content/tasks; image view owns options/modal DOM.
 * No renderer, output implementation, mutable PNG or classic global lookup.
 */
export function createExportController({ requests, tasks, owners, imageView, preview, readInput, notify, translate, reportError=()=>{}, record=()=>{}, now=()=>Date.now() }={}) {
  if(typeof requests?.createRequest!=='function'||typeof tasks?.isCancelled!=='function'
    || !['markdown','html','word','pdf'].every(format=>typeof owners?.[format]?.export==='function')
    || !['render','save'].every(method=>typeof owners?.image?.[method]==='function')
    || !['getOptions','setRatio','resetCrop','open','close'].every(method=>typeof imageView?.[method]==='function')
    || !['getViewMode','setViewMode'].every(method=>typeof preview?.[method]==='function')
    || ![readInput,notify,translate,reportError,record,now].every(fn=>typeof fn==='function'))throw new TypeError('Export Controller requires public request, format, image-view and notification capabilities.');
  let destroyed=false;
  const alive=()=>{if(destroyed)throw new ExportCancelledError('destroyed');};
  const known=action=>Object.hasOwn(formats,action)||['openImage','closeImage','selectRatio'].includes(action);
  async function run(action,payload={}) {
    alive();
    if(action==='closeImage')return imageView.close('feature-close');
    if(action==='selectRatio'){imageView.setRatio(payload.ratio);return run('renderImage');}
    if(action==='openImage'){
      if(preview.getViewMode()!=='preview')preview.setViewMode('preview');
      imageView.resetCrop();imageView.open();return run('renderImage');
    }
    const format=formats[action];let request;
    try {
      const input=Object.hasOwn(payload,'input')?payload.input:readInput();
      if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('导出请求无效');
      request=requests.createRequest({...input,format,...(format==='image'?{imageOptions:Object.hasOwn(input,'imageOptions')?input.imageOptions:imageView.getOptions()}:{})});
    } catch(error){if(!destroyed)notify('导出参数无效：'+(error?.message||String(error)));return Object.freeze({status:'invalid'});}
    try {
      alive();
      const method=action==='renderImage'?'render':action==='saveImage'?'save':'export';
      const result=await owners[format][method]({request});alive();
      if(result.status==='busy')notify('当前导出正在生成文件，请稍候');
      else if(result.status==='no-preview')notify(translate('toastGeneratePreviewFirst'));
      else if(['written','downloaded','ready'].includes(result.status)&&successKeys[action])notify(translate(successKeys[action]));
      return result;
    } catch(error){
      if(destroyed||isExportCancelledError(error)||tasks.isCancelled(error))return Object.freeze({status:'cancelled',reason:destroyed?'destroyed':error.reason});
      if(action!=='saveImage')reportError(error);
      const message=error?.message||String(error);
      notify(action==='renderImage'?translate('toastImageGenFailed',message):action==='saveImage'?'图片导出失败：'+message:action==='exportMarkdown'?'导出失败：'+message:message);
      return Object.freeze({status:'failed'});
    }
  }
  return Object.freeze({has(action){return !destroyed&&known(action);},invoke(action,payload={}){
    alive();if(!known(action))throw new TypeError('Unknown export command.');
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new TypeError('Export command payload must be an object.');
    const metric=({exportMarkdown:'exportFile',exportHtml:'exportHTML',exportWord:'exportWord',exportPdf:'exportPDF',saveImage:'downloadExportImage'})[action];
    const start=now();
    const report=status=>{if(!metric)return;try{record(metric,{category:'export.operation',durationMs:Math.max(0,now()-start),status});}catch{/* Metrics never replace command results. */}};
    return run(action,payload).then(result=>{report(result?.status==='failed'?'error':'ok');return result;},error=>{report('error');throw error;});
  },destroy(){if(destroyed)return;destroyed=true;imageView.close('destroy');}});
}
