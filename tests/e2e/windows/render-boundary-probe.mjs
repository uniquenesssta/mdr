// Inert canary payloads only. This is a baseline observation, not a sanitizer.
export const PROBE_SURFACES = Object.freeze([
  'preview-markdown', 'preview-full-html', 'preview-block-html', 'hybrid-html-widget'
]);

export function createRenderBoundaryProbe(id, markerOrigin) {
  if (!/^r12-[a-z-]+$/.test(id)) throw new TypeError('Invalid probe id.');
  const origin = new URL(markerOrigin);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') {
    throw new TypeError('Probe requests must target the owned loopback marker server.');
  }
  const mark = kind => `window.__r12Probe.events.push('${kind}')`;
  const ipc = "window.__r12Probe.ipcAttempted=true;"
    + "window.__TAURI_INTERNALS__.invoke('read_dropped_file',{path:window.__r12CanaryPath})"
    + ".then(r=>window.__r12Probe.ipc={resolved:true,canaryMatches:r.content===window.__r12CanaryText})"
    + ".catch(()=>window.__r12Probe.ipc={resolved:false,canaryMatches:false})";
  const frame = `<script>parent.__r12Probe.events.push('srcdoc-script')</script>`;
  const html = `<div data-r12-probe="${id}">
<p data-r12-kind="text">R12 harmless marker</p>
<img data-r12-kind="event" src="/${id}-missing.png" onerror="${mark('img-onerror')}">
<button data-r12-kind="click" onclick="${mark('button-onclick')}">marker click</button>
<a data-r12-kind="javascript" href="javascript:${mark('javascript-url')}">marker URL</a>
<svg data-r12-kind="svg" onload="${mark('svg-onload')}"><circle r="1"/></svg>
<iframe data-r12-kind="srcdoc" srcdoc="${frame.replaceAll('"', '&quot;')}"></iframe>
<object data-r12-kind="object" type="text/html" data="data:text/html,harmless-object-marker"></object>
<embed data-r12-kind="embed" type="text/html" src="data:text/html,harmless-embed-marker">
<img data-r12-kind="ipc" src="/${id}-ipc-missing.png" onerror="${ipc}">
<img data-r12-kind="remote-image" src="${origin.origin}/marker/${id}/image" alt="owned loopback marker">
<style>[data-r12-probe="${id}"] [data-r12-kind="css"]{background-image:url('${origin.origin}/marker/${id}/css')}</style>
<span data-r12-kind="css">CSS marker</span>
</div>`;
  return Object.freeze({ id, html, markdown: `# R12 baseline\n\n${html}\n\nend of owned fixture\n` });
}
