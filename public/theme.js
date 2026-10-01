'use strict';
// Pre-paint theme bootstrap (loaded synchronously in <head>, before any stylesheet paints):
// 1) cached user choice (localStorage 'nova-theme': system|light|dark), 2) 'system' → prefers-color-scheme.
// app.js re-applies after /me/preferences answers; this only prevents a flash of the wrong theme.
(function(){
 var mq=window.matchMedia?window.matchMedia('(prefers-color-scheme: light)'):null;
 function resolve(pref){return pref==='light'||pref==='dark'?pref:(mq&&mq.matches?'light':'dark')}
 function apply(pref){var t=resolve(pref);document.documentElement.dataset.theme=t;document.documentElement.dataset.themePref=pref;
  var meta=document.querySelector('meta[name=theme-color]');if(!meta){meta=document.createElement('meta');meta.name='theme-color';document.head.appendChild(meta)}meta.content=t==='light'?'#f6f8f6':'#090b0d'}
 var pref='system';try{var c=localStorage.getItem('nova-theme');if(c==='light'||c==='dark'||c==='system')pref=c}catch(e){}
 apply(pref);
 if(mq&&mq.addEventListener)mq.addEventListener('change',function(){if(document.documentElement.dataset.themePref==='system')apply('system')});
 window.novaTheme={apply:function(p){try{localStorage.setItem('nova-theme',p)}catch(e){}apply(p)},current:function(){return document.documentElement.dataset.themePref||'system'}};
})();
