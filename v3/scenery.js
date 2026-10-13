/* Le Défi Boréal V3 — original scenery, authored assets and parallax compositor.
 * The panorama is AI-generated original pixel art; animated planes are authored here.
 * Coordinates passed by the V2 engine are CSS pixels. All small sprites are cached
 * raster images and painted with smoothing disabled, never regenerated per frame.
 */
(() => {
  'use strict';
  const scriptURL = document.currentScript && document.currentScript.src;
  const embedded=window.BorealEmbeddedAssets;
  const imageURL=path=>embedded?.images[path]||new URL(path,scriptURL||document.baseURI).href;
  const assetURL = imageURL('assets/forest-panorama.png');
  const landscapeAssetURL = imageURL('assets/forest-landscape.png');
  const treesAssetURL = imageURL('assets/forest-trees.png');
  const panorama = new Image();
  const landscape = new Image();
  const treeImage = new Image();
  const planes = Object.freeze([
    {name:'Ciel et panorama boréal',speed:.008},
    {name:'Étoiles et aurores',speed:.018},
    {name:'Épinettes lointaines',speed:.075},
    {name:'Reflets du lac',speed:.11},
    {name:'Rive et sous-bois',speed:.18},
    {name:'Conifères proches',speed:.28},
    {name:'Faune décorative',speed:.37},
    {name:'Sentier et aiguilles',speed:.72},
    {name:'Fougères et fleurs',speed:.91}
  ]);
  let loaded = false;
  let loadError = null;
  const imageReady=(image,url,label)=>new Promise((resolve,reject)=>{
    image.onload=resolve;
    image.onerror=()=>{loadError=`Le panorama boréal ${label} n’a pas pu être chargé.`;reject(new Error(loadError));};
    image.src=url;
  });
  const ready=Promise.all([imageReady(panorama,assetURL,'portrait'),imageReady(landscape,landscapeAssetURL,'paysage'),imageReady(treeImage,treesAssetURL,'conifères')])
    .then(()=>{
      // Crop original transparent tree artwork once into native sprite images.
      const regions=[[0,0,510,1024],[510,0,610,1024],[1120,0,416,1024]];
      sprites.trees.splice(0,3,...regions.map(([x,y,w,h])=>{
        const s=surface(Math.round(w/h*180),180),c=s.getContext('2d');c.imageSmoothingEnabled=false;
        c.drawImage(treeImage,x,y,w,h,0,0,s.width,s.height);return s;
      }));
      loaded=true;return {loaded:true};
    });
  function rng(seed) { let n=seed>>>0; return () => {n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;}; }
  const mod = (n,d) => ((n%d)+d)%d;
  const pixel = (c,x,y,w,h,color) => {c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));};
  function surface(w,h) {const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
  function line(c,x0,y0,x1,y1,color,width=1) {
    // Integer Bresenham: branches and antlers have the same crisp grid as sprites.
    x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
    const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;
    let err=dx+dy;
    for(;;){pixel(c,x0,y0,width,width,color);if(x0===x1&&y0===y1)break;const e=2*err;if(e>=dy){err+=dy;x0+=sx;}if(e<=dx){err+=dx;y0+=sy;}}
  }
  function tree(seed,kind=0) {
    const s=surface(76,180),c=s.getContext('2d'),r=rng(seed),cx=37;
    const dark=['#102a2c','#102c2b','#183637'][kind%3],mid=['#244945','#31544a','#2f5550'][kind%3];
    const light=['#607963','#727c56','#6d8a6f'][kind%3];
    // Tapered bark, broken branch fans, individually shaded needle clusters.
    pixel(c,cx-2,12,5,168,'#302a28');pixel(c,cx,32,2,140,'#604539');
    for(let y=16;y<166;y+=6){const breadth=Math.min(33,(y-9)*.24)*(0.8+r()*.22);
      for(const side of [-1,1]){const tipX=cx+side*breadth,tipY=y+5+r()*8;
        line(c,cx,y-1,tipX,tipY,'#574332');
        const count=Math.ceil(breadth/2.2);
        for(let j=0;j<count;j++){const q=j/count,x=cx+(tipX-cx)*q,yy=y+(tipY-y)*q;
          const drop=3+q*7+r()*4;
          line(c,x,yy,x+side*(2+r()*3),yy+drop,dark,2);
          pixel(c,x-2,yy-1,5,3,dark);
          if(r()>.16)line(c,x,yy,x+side*(2+r()*3),yy+drop*.66,mid);
          if(side===-1&&r()>.22)pixel(c,x-1,yy,2,1,light);
          if(side===-1&&r()>.67)pixel(c,x-2,yy+2,1,2,'#b38457');
        }
      }
    }
    for(let y=3;y<42;y+=4){line(c,cx,y,cx-3,y+6,mid);line(c,cx,y,cx+3,y+8,dark);pixel(c,cx-1,y,1,2,light);}
    // Exposed roots, furrowed trunk and a little lichen.
    line(c,cx-1,170,cx-7,179,'#504335',2);line(c,cx+2,170,cx+8,179,'#382f28',2);
    for(let i=0;i<16;i++)pixel(c,cx-1+r()*3,135+r()*35,1,3,i%3?'#42362c':'#68816a');
    return s;
  }
  function fern(seed,flower=false) {
    const s=surface(42,39),c=s.getContext('2d'),r=rng(seed);
    for(let j=0;j<7;j++){const angle=-2.7+j*.38,ex=21+Math.cos(angle)*(16+r()*5),ey=35+Math.sin(angle)*(23+r()*8);
      line(c,21,36,ex,ey,'#546f4d');
      for(let q=.22;q<1;q+=.12){const x=21+(ex-21)*q,y=36+(ey-36)*q;
        line(c,x,y,x-3+q*1.5,y-3, j%2?'#739164':'#3f695a');
        line(c,x,y,x+3-q,y-1, '#294e42');pixel(c,x,y,1,1,'#a1a775');}
    }
    if(flower){line(c,31,33,32,7,'#658768');for(let i=0;i<5;i++){pixel(c,29+i%2*2,8+i*3,4,2,i%2?'#c98799':'#b15e82');pixel(c,31,8+i*3,1,1,'#efd4bc');}}
    return s;
  }
  function shrub(seed) {
    const s=surface(54,34),c=s.getContext('2d'),r=rng(seed);
    for(let i=0;i<34;i++){const x=5+r()*43,y=8+r()*23;line(c,26,33,x,y,'#384937');pixel(c,x,y,4+r()*3,2+r()*2,i%3?'#284e42':'#5e7451');if(i%4===0)pixel(c,x+1,y,1,1,'#96966c');if(i%7===0){pixel(c,x,y+3,3,3,'#46537b');pixel(c,x,y+3,1,1,'#af9bbe');}}
    return s;
  }
  function animal(rows,palette){const s=surface(rows.reduce((m,row)=>Math.max(m,row.length),0),rows.length),c=s.getContext('2d');rows.forEach((row,y)=>[...row].forEach((key,x)=>{if(palette[key])pixel(c,x,y,1,1,palette[key]);}));return s;}
  const deer = animal([
    '...........................A.......A.......',
    '........................A..A....A..A.......',
    '.........................A.A.....AA........',
    '.......................A..AA.....AA.A......',
    '........................AAAA....AAA........',
    '..........................AA.....A.........',
    '.......................DD..AA....A.........',
    '.......................DMD..AAAAAA.........',
    '........................DDD.DHHHHH.........',
    '.........................DDDDHHEHHH........',
    '..........................DDDHHDHHHBN......',
    '...........................DDDMMHHHBN......',
    '...........................DDDMMHHH........',
    '.........................DDDDDDMMH.........',
    '.......................DDDDDDDMMHH.........',
    '...D..................DDDDDDDDMMHH..........',
    '..DDDDDDDDDDDDDDDDDDDDDDDDDDDMMHH..........',
    '..DDHHHHHHHHHHHHHHHHHHHHHDDDDDMMH..........',
    '..DHHHHHHHHHHHHHHHHHHHHHHHDDDDMMH..........',
    '...DHHHSSHHHHHHHHHHHHHHHHHHDDMMH...........',
    '...DDHHHHHHHHHHHHHHHHHHHHHDDDDMH...........',
    '....DDDDHHHHHHHHHHHHHHHHHDDDDMH............',
    '.....DDDDDDMMMMMMMMMMMDDDDDDMMH............',
    '.....DD.DDMMMMMMMMMMMD..DD.MHH.............',
    '.....DD..DD............DD..MH..............',
    '.....DD...DD...........DD..MH..............',
    '.....DD....DD..........DD.MH...............',
    '.....MD.....DD.........MD.MH...............',
    '.....MD......DD........MD.MH...............',
    '.....MD.......MD.......MD.MH...............',
    '.....MD.......MD.......MD.MH...............',
    '.....MD.......MD.......MD.MH...............',
    '.....MN.......MN.......MN.MN...............',
    '.....NN.......NN.......NN.NN...............'
  ],{A:'#bdab87',D:'#7e5b40',H:'#a97d50',M:'#493c32',S:'#c5a071',B:'#d3c0a2',N:'#1e2b2b',E:'#0f1c22'});
  const squirrel=animal([
    '....TTT..................',
    '..TTTHHT.................',
    '.TTHHHHHT................',
    'TTHHHHHHT................',
    'THHHHHTTT........EE..E...',
    'THHHHT..........EHHEEE...',
    'TTHHHT..........EHHHHHE..',
    '.THHHHT.........HHHKHHHN.',
    '.TTHHHHT......HHHSHHHHE..',
    '..TTHHHHT...HHHHHSSSHE...',
    '...TTHHHHHHHHHHHHSSHH....',
    '.....HHHHHHHHHHHHSHH.....',
    '......HHHHHHHHHHHSHHE....',
    '.......HHHHHHHHHSSHE.....',
    '.......EHHHHHHHHHHE......',
    '.......EEEHHHHHHHE.......',
    '......EEE...EEE..EE......',
    '....EEEEE...EEEEEEE......'
  ],{T:'#684334',H:'#b67d46',S:'#e0b77b',E:'#543e30',K:'#111e23',N:'#29332e'});
  const owl=animal([
    '.D............D.',
    '.DDDD......DDDD.',
    '.DHHHDDDDDDHHHD.',
    'DDHHHHHHHHHHHHDD',
    'DHMMMMHHMMMMHHHD',
    'DHMSSMHSSSSMHHHD',
    'DHMKSMHMSKSMHHHD',
    'DHMSSMHMSSSMHHHD',
    'DHHMMMHGMMMHHHHD',
    'DDHHHHHGGHHHHHDD',
    'DDHHHSSHHSSHHHDD',
    '.DHHMHHMMHHMHHD.',
    '.DDHMHHMMHHMHDD.',
    '..DDHMHMMHMHDD..',
    '...DDHHHHHHDD...',
    '....DDHHHHDD....',
    '.....DGGGGD.....',
    '......G..G......'
  ],{D:'#3a3733',H:'#916e4e',M:'#c39b6b',S:'#ded6b0',K:'#141f27',G:'#cc9b52'});
  function bird(frame) {
    const s=surface(35,19),c=s.getContext('2d'),color='#253847';
    const y=frame?4:12;line(c,17,11,3,y,color,2);line(c,3,y,0,y+4,color);line(c,17,11,30,y-2,color,2);line(c,30,y-2,34,y+2,color);
    pixel(c,15,9,6,5,'#674b40');pixel(c,20,8,4,3,'#bba786');pixel(c,23,10,3,1,'#e1b67f');line(c,16,12,12,16,color,2);return s;
  }
  const sprites = {
    trees:[tree(145,0),tree(278,1),tree(391,2)],
    ferns:[fern(526),fern(832,true),fern(763)],
    shrubs:[shrub(818),shrub(973)],deer,squirrel,owl,birds:[bird(0),bird(1)]
  };
  const trail=surface(768,112),tc=trail.getContext('2d'),tr=rng(6327);
  // Transparent soil tile keeps the painted foreground visible below the path.
  pixel(tc,0,0,768,2,'#bea77b');pixel(tc,0,2,768,3,'#785e45');pixel(tc,0,5,768,6,'#473c35');
  for(let i=0;i<460;i++){const x=tr()*768,y=8+tr()*102;const col=['#ac8056','#806345','#746751','#333c35','#647057'][i%5];pixel(tc,x,y,1+tr()*3,1+tr()*2,col);if(i%11===0)line(tc,x,y,x+5,y-1,'#493b32');}
  for(let i=0;i<22;i++){const x=tr()*768,y=30+tr()*80;line(tc,x,y,x+16,y-3,'#493c32');line(tc,x+9,y-2,x+16,y-6,'#6e5541');}
  function sprite(c,img,x,y,scale=1,opacity=1) {
    if(opacity!==1)c.globalAlpha=opacity;
    c.drawImage(img,Math.round(x),Math.round(y),Math.round(img.width*scale),Math.round(img.height*scale));
    if(opacity!==1)c.globalAlpha=1;
  }
  function movingX(index,gap,world,rate,width,margin=100,seed=0) {
    const span = Math.max(gap*3,Math.ceil((width+margin*2)/gap)*gap);
    return mod(index*gap+seed-world*rate,span)-margin;
  }
  function draw(c,{width:W,height:H,ground:g,world=0,time=0}) {
    c.save();c.imageSmoothingEnabled=false;
    // 1 — panorama: its trail line is aligned to the engine's existing ground.
    // Clear the complete logical viewport, including landscape margins. Each
    // orientation has its own original illustration, never stretched sideways.
    pixel(c,0,0,W,H,'#152a34');
    const wide=W/H>.88,backdrop=wide?landscape:panorama,path=wide?.764:.771,ratio=wide?1.5:2/3;
    const bgH=Math.max(H,g/path,W/ratio),bgW=bgH*ratio;
    const baseX=(W-bgW)/2+Math.sin(world*.000045)*Math.min(11,(bgW-W)*.22);
    if(loaded)c.drawImage(backdrop,Math.round(baseX),Math.round(g-bgH*path),Math.ceil(bgW),Math.ceil(bgH));
    else {const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#142a43');sky.addColorStop(.43,'#ba7b88');sky.addColorStop(1,'#173c34');c.fillStyle=sky;c.fillRect(0,0,W,H);}
    // 2 — live sky sparkles and a sparse shimmering aurora curtain.
    for(let i=0;i<23;i++){const x=mod(i*79+17-world*.018,W+4),y=13+mod(i*53,Math.max(28,g*.27));
      c.globalAlpha=.25+(Math.sin(time*.8+i*2)*.5+.5)*.35;pixel(c,x,y,1,1,'#dfddd0');}
    c.globalAlpha=1;
    for(let i=0;i<22;i++){const x=mod(i*19-world*.018,W+65)-30,y=g*.12+Math.sin(i*.29+time*.08)*g*.085;
      c.globalAlpha=.045+(Math.sin(i*.18+time*.1)+1)*.012;pixel(c,x,y,3,20+i%5*4,'#8fe5c0');}
    c.globalAlpha=1;
    // 3 — thin moving tree line behind the lakeside. High detail is in cached sprites.
    const farCount=Math.ceil((W+160)/79);
    for(let i=0;i<farCount;i++){const x=movingX(i,79,world,.075,W,80,49);sprite(c,sprites.trees[i%3],x,g-121-(i%3)*7,.32,.53);}
    // 4 — broken lake reflections stay above the running lane.
    for(let i=0;i<18;i++){const x=mod(i*67-world*.11,W+80)-40,y=g*.665+(i%7)*6;
      c.globalAlpha=.13+Math.sin(time*.9+i)*.035;pixel(c,x,y,11+i%4*6,1,i%3?'#d9aa96':'#84c4b1');}
    c.globalAlpha=1;
    // 5 — low shoreline underbrush, moving independently of trunks and ground.
    const shrubs=Math.ceil((W+160)/117);
    for(let i=0;i<shrubs;i++){const x=movingX(i,117,world,.18,W,80,71);sprite(c,sprites.shrubs[i%2],x,g-31-(i%2)*6,1.12,.73);}
    // 6 — tall varied spruces, spaced to leave the obstacles readable.
    const nearCount=Math.ceil((W+360)/291);
    for(let i=0;i<nearCount;i++){const x=movingX(i,291,world,.28,W,180,184),size=1.03+i%3*.14;sprite(c,sprites.trees[(i+1)%3],x,g-180*size-24,size,.88);}
    // 7 — fauna is decorative and always drawn behind the runner and obstacles.
    const deerX=movingX(0,Math.max(410,W+180),world,.37,W,110,W*.79+110);
    sprite(c,sprites.deer,deerX,g-70,1.44,.96);
    const squirrelX=movingX(0,Math.max(390,W+130),world,.42,W,65,W*.38+65);
    const bob=Math.sin(time*1.8)*.75;sprite(c,sprites.squirrel,squirrelX,g-26+bob,1.15);
    // The owl travels with an actual spruce, perched beside its trunk.
    const owlTree=movingX(0,291,world,.28,W,180,184);
    const owlX=owlTree+sprites.trees[1].width*.52*1.03;
    pixel(c,owlX-4,g-80,26,2,'#493b32');sprite(c,sprites.owl,owlX,g-101,1.25);
    const wing=Math.floor(time*5)%2;
    const birdX=mod(W*.62+world*.024+time*3,W+70)-35;
    sprite(c,sprites.birds[wing],birdX,g*.32+Math.sin(time*.35)*8,1.15,.9);
    // 8 — horizontal trail: a fixed readable collision line with scrolling texture.
    const tileW=trail.width,offset=mod(world*.72,tileW);
    for(let x=-offset;x<W;x+=tileW)c.drawImage(trail,Math.round(x),Math.round(g),tileW,112);
    // 9 — foreground foliage below the collision line, never masking a hazard.
    const fernCount=Math.ceil((W+110)/72);
    for(let i=0;i<fernCount;i++){const x=movingX(i,72,world,.91,W,70,41),size=.82+(i%3)*.17;
      sprite(c,sprites.ferns[i%3],x,g+41+(i%3)*21,size,.96);}
    c.restore();
  }
  function atlas() {
    const out=surface(512,256),c=out.getContext('2d');
    sprites.trees.forEach((s,i)=>c.drawImage(s,i*112,0));
    sprites.ferns.forEach((s,i)=>c.drawImage(s,342+i*48,0));
    sprites.shrubs.forEach((s,i)=>c.drawImage(s,342+i*64,46));
    c.drawImage(deer,342,94);c.drawImage(squirrel,402,94);c.drawImage(owl,443,94);
    sprites.birds.forEach((s,i)=>c.drawImage(s,342+i*48,144));
    return out;
  }
  window.BorealScenery = Object.freeze({draw,ready,layers:planes,sprites,atlas,assetURL,landscapeAssetURL,treesAssetURL,get loaded(){return loaded;},get error(){return loadError;}});
})();
