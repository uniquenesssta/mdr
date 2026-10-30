import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserInteractionPolicy } from '../../../src/features/menu/browser-interaction-policy.js';

// Node24 boolean capture removal differs from DOM; normalize options for the test surface.
class DocumentEvents extends EventTarget {
  addEventListener(type,listener,options) { super.addEventListener(type,listener,typeof options==='boolean'?{capture:options}:options); }
  removeEventListener(type,listener,options) { super.removeEventListener(type,listener,typeof options==='boolean'?{capture:options}:options); }
}

test('page menus and navigation shortcuts are suppressed; app editing shortcuts and disposal remain intact',()=>{
  const doc=new DocumentEvents(),owner=createBrowserInteractionPolicy(doc);
  const dispatch=(type,properties={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,properties);doc.dispatchEvent(e);return e.defaultPrevented;};
  assert.equal(dispatch('contextmenu'),true);
  for(const properties of [{key:'F5'},{key:'F12'},{key:'r',ctrlKey:true},{key:'p',ctrlKey:true},{key:'ArrowLeft',altKey:true}])assert.equal(dispatch('keydown',properties),true);
  for(const key of ['a','c','v','s','z','b','u'])assert.equal(dispatch('keydown',{key,ctrlKey:true}),false);
  owner.destroy();assert.equal(dispatch('contextmenu'),false);assert.equal(dispatch('keydown',{key:'F5'}),false);
});
