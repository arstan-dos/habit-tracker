var CACHE='rhythm-v3';
var ASSETS=['./','./index.html','./styles.css','./model.js','./app.js','./manifest.json','./icon.svg'];

self.addEventListener('install',function(event){
  event.waitUntil(caches.open(CACHE).then(function(cache){return cache.addAll(ASSETS);}));
  self.skipWaiting();
});

self.addEventListener('activate',function(event){
  event.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(key){return key!==CACHE;}).map(function(key){return caches.delete(key);}));
  }).then(function(){return self.clients.claim();}));
});

self.addEventListener('fetch',function(event){
  if(event.request.method!=='GET')return;
  var url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(function(response){
      if(response.ok)caches.open(CACHE).then(function(cache){cache.put('./index.html',response.clone());});
      return response;
    }).catch(function(){return caches.match('./index.html');}));
    return;
  }

  event.respondWith(caches.match(event.request).then(function(cached){
    var update=fetch(event.request).then(function(response){
      if(response.ok)caches.open(CACHE).then(function(cache){cache.put(event.request,response.clone());});
      return response;
    });
    return cached||update;
  }));
});


