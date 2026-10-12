const KEY='markdownEditorExportCommandPort';
/** Scoped command capability for remaining Menu/classic callers; no global aliases or state. */
export function mountClassicExportCommandPort(host,controller) {
  if(!host||typeof host!=='object'||typeof controller?.has!=='function'||typeof controller?.invoke!=='function')throw new TypeError('Export commands and host are required.');
  if(Object.hasOwn(host,KEY))throw new Error('Export command port already mounted.');
  let destroyed=false;
  const alive=()=>{if(destroyed)throw new Error('Export command port is destroyed.');};
  const port=Object.freeze({has(action){return !destroyed&&controller.has(action);},invoke(action,payload){alive();return controller.invoke(action,payload);}});
  Object.defineProperty(host,KEY,{value:port,configurable:true,enumerable:false});
  return Object.freeze({port,destroy(){if(destroyed)return;destroyed=true;if(host[KEY]===port)delete host[KEY];}});
}
