const novaIcons={
 spark:'<svg viewBox="0 0 32 32"><path d="M16 3c1 7 4 11 13 13-9 2-12 6-13 13-1-7-4-11-13-13C12 14 15 10 16 3Z"/><circle cx="16" cy="16" r="2"/></svg>',
 clock:'<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11"/><path d="M16 9.5V16l4 3"/></svg>',settings:'<svg viewBox="0 0 32 32"><path d="M5 9h14M24 9h3M5 16h3m5 0h14M5 23h11m5 0h6"/><circle cx="21.5" cy="9" r="2.5"/><circle cx="10.5" cy="16" r="2.5"/><circle cx="18.5" cy="23" r="2.5"/></svg>',
 provider:'<svg viewBox="0 0 32 32"><path d="M8 6h16v7H8zM6 19h8v7H6zm12 0h8v7h-8zM16 13v3M10 16h12"/></svg>',
 cv:'<svg viewBox="0 0 32 32"><path d="M7 4h13l5 5v19H7zM20 4v6h5"/><circle cx="13" cy="14" r="2.5"/><path d="M9 21c1.5-3 6.5-3 8 0m3-5h2m-2 5h2"/></svg>',
 doc:'<svg viewBox="0 0 32 32"><path d="M8 4h12l5 5v19H8zM20 4v6h5M12 15h9m-9 5h9m-9 5h6"/></svg>',
 web:'<svg viewBox="0 0 32 32"><circle cx="14" cy="14" r="9"/><path d="M5 14h18M14 5c3 3 3 15 0 18M14 5c-3 3-3 15 0 18m7 16 6 6"/><circle cx="23" cy="23" r="5"/></svg>',
 voice:'<svg viewBox="0 0 32 32"><rect x="12" y="4" width="8" height="15" rx="4"/><path d="M7 15v1a9 9 0 0 0 18 0v-1M16 25v4m-5 0h10"/></svg>',
 study:'<svg viewBox="0 0 32 32"><path d="m4 11 12-6 12 6-12 6zM8 14v7c4 4 12 4 16 0v-7M28 11v9"/></svg>',
 letter:'<svg viewBox="0 0 32 32"><path d="M5 7h22v18H5zM5 9l11 9L27 9M21 4h7"/></svg>',
 plus:'<svg viewBox="0 0 32 32"><path d="M16 6v20M6 16h20"/></svg>',
 send:'<svg viewBox="0 0 32 32"><path d="m5 16 22-10-7 21-5-8zM15 19 27 6"/></svg>',
 chevron:'<svg viewBox="0 0 32 32"><path d="m12 8 8 8-8 8"/></svg>',
 back:'<svg viewBox="0 0 32 32"><path d="M26 16H7m7-8-8 8 8 8"/></svg>'
};
function novaIcon(name,label){const span=document.createElement('span');span.className='nova-icon';span.innerHTML=novaIcons[name]||novaIcons.spark;span.setAttribute('aria-hidden','true');if(label)span.title=label;return span}
