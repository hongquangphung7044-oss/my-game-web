import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');
const hud = document.querySelector('#hud');
const start = document.querySelector('#start-screen');
const menu = document.querySelector('#menu');
const playBtn = document.querySelector('#play-btn');
const continueBtn = document.querySelector('#continue-btn');
const statusEl = document.querySelector('#status');
const coordsEl = document.querySelector('#coords');
const hotbar = document.querySelector('#hotbar');
const STORE = 'my-game-world-v1';

const TYPES = [
  { id:1, name:'草地', icon:'🟩', color:0x57a63f, roughness:.95 },
  { id:2, name:'泥土', icon:'🟫', color:0x86532d, roughness:1 },
  { id:3, name:'石头', icon:'⬜', color:0x85898a, roughness:.85 },
  { id:4, name:'原木', icon:'🪵', color:0x81512f, roughness:.9 },
  { id:5, name:'树叶', icon:'🍃', color:0x2d7c36, roughness:1, transparent:true },
  { id:6, name:'沙子', icon:'🟨', color:0xdac06d, roughness:1 }
];
const typeById = Object.fromEntries(TYPES.map(x=>[x.id,x]));
let selected = 0;
let world = new Map(), meshes = [], target = null, playing = false;
const key = (x,y,z)=>`${x}|${y}|${z}`;
const get = (x,y,z)=>world.get(key(x,y,z)) || 0;
const set = (x,y,z,t)=> t ? world.set(key(x,y,z),t) : world.delete(key(x,y,z));
const solid = (x,y,z)=>get(x,y,z)!==0;

const renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x63b8ea);
scene.fog = new THREE.Fog(0x63b8ea, 22, 52);
const camera = new THREE.PerspectiveCamera(72, 1, .05, 100);
const hemi = new THREE.HemisphereLight(0xbfe8ff, 0x45512d, 2.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4cb, 2.2); sun.position.set(12,25,8); scene.add(sun);
const group = new THREE.Group(); scene.add(group);
const geometry = new THREE.BoxGeometry(1,1,1);
const raycaster = new THREE.Raycaster(); raycaster.far=7;
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02,1.02,1.02)), new THREE.LineBasicMaterial({color:0xffffff, depthTest:false}));
outline.visible=false; scene.add(outline);

function generate() {
  world.clear();
  const size=17;
  for(let x=-size;x<=size;x++) for(let z=-size;z<=size;z++) {
    const h=Math.max(2, Math.floor(4 + Math.sin(x*.32)*1.6 + Math.cos(z*.27)*1.4 + Math.sin((x+z)*.15)*1.2));
    for(let y=0;y<=h;y++) set(x,y,z, y===h ? (h<4?6:1) : (y>h-3?2:3));
    const tree = ((x*31+z*17)%37===0) && Math.abs(x)>3 && Math.abs(z)>3 && h>=4;
    if(tree) { for(let y=h+1;y<h+4;y++)set(x,y,z,4); for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=2;dy<=4;dy++)if(Math.abs(dx)+Math.abs(dz)+Math.abs(dy-3)<4 && !get(x+dx,h+dy,z+dz))set(x+dx,h+dy,z+dz,5); }
  }
}
function load() {
  try { const raw=localStorage.getItem(STORE); if(!raw)return false; world=new Map(JSON.parse(raw)); return world.size>0; } catch {return false;}
}
function save() { localStorage.setItem(STORE, JSON.stringify([...world])); }
function surfaceY(x,z) { for(let y=18;y>=-1;y--) if(solid(Math.floor(x),y,Math.floor(z))) return y+1; return 1; }
function visible(x,y,z) { return !solid(x+1,y,z)||!solid(x-1,y,z)||!solid(x,y+1,z)||!solid(x,y-1,z)||!solid(x,y,z+1)||!solid(x,y,z-1); }
function rebuild() {
  meshes.forEach(m=>group.remove(m)); meshes=[];
  for(const type of TYPES) {
    const blocks=[]; for(const [k,t] of world) if(t===type.id) { const [x,y,z]=k.split('|').map(Number); if(visible(x,y,z)) blocks.push([x,y,z]); }
    if(!blocks.length)continue;
    const mat=new THREE.MeshLambertMaterial({color:type.color, transparent:!!type.transparent, opacity:type.transparent?.86:1});
    const mesh=new THREE.InstancedMesh(geometry,mat,blocks.length); mesh.userData.blocks=blocks; mesh.userData.type=type.id;
    const matrix=new THREE.Matrix4(); blocks.forEach(([x,y,z],i)=>{matrix.makeTranslation(x,y+.5,z);mesh.setMatrixAt(i,matrix)}); mesh.instanceMatrix.needsUpdate=true; group.add(mesh); meshes.push(mesh);
  }
  save();
}

const player={x:0,y:9,z:8,vy:0,yaw:Math.PI,pitch:-.12,onGround:false};
const held={}, move={x:0,z:0};
function updateCamera(){camera.position.set(player.x,player.y+1.58,player.z);camera.rotation.order='YXZ';camera.rotation.y=player.yaw;camera.rotation.x=player.pitch;}
function collides(x,y,z){
  const r=.28, h=1.72;
  for(let bx=Math.floor(x-r);bx<=Math.floor(x+r);bx++)for(let bz=Math.floor(z-r);bz<=Math.floor(z+r);bz++)for(let by=Math.floor(y);by<=Math.floor(y+h-.01);by++)if(solid(bx,by,bz))return true;
  return false;
}
function movePlayer(dx,dz,dt){
 const speed=(held.Shift?6:4.25)*dt;
 const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw), rx=Math.cos(player.yaw), rz=-Math.sin(player.yaw);
 const vx=(fx*dz+rx*dx)*speed, vz=(fz*dz+rz*dx)*speed;
 if(!collides(player.x+vx,player.y,player.z)) player.x+=vx;
 if(!collides(player.x,player.y,player.z+vz)) player.z+=vz;
}
function act(kind){
 if(!target)return;
 const {x,y,z,nx,ny,nz}=target;
 if(kind==='break') { set(x,y,z,0); rebuild(); }
 else { const px=x+nx,py=y+ny,pz=z+nz; if(!collides(px+.5,py,pz+.5)) { set(px,py,pz,TYPES[selected].id); rebuild(); } }
}
function selectTarget(){
 raycaster.setFromCamera(new THREE.Vector2(0,0),camera); const hit=raycaster.intersectObjects(meshes,false)[0];
 if(!hit){target=null;outline.visible=false;return;}
 const [x,y,z]=hit.object.userData.blocks[hit.instanceId]; const n=hit.face.normal;
 target={x,y,z,nx:Math.round(n.x),ny:Math.round(n.y),nz:Math.round(n.z)}; outline.position.set(x,y+.5,z);outline.visible=true;
}
function makeHotbar(){hotbar.innerHTML=''; TYPES.forEach((type,i)=>{const b=document.createElement('button');b.className='slot'+(i===selected?' active':'');b.innerHTML=`${type.icon}<small>${i+1} ${type.name}</small>`;b.onclick=()=>{selected=i;makeHotbar()};hotbar.append(b)});}

function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
addEventListener('resize',resize); resize();
addEventListener('keydown',e=>{held[e.code]=true;if(e.code==='Space')e.preventDefault();if(e.code>='Digit1'&&e.code<='Digit6'){selected=+e.code.at(-1)-1;makeHotbar();}});
addEventListener('keyup',e=>held[e.code]=false);
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{if(!playing)return; if(e.pointerType==='mouse'){canvas.requestPointerLock?.();if(e.button===0)act('break');if(e.button===2)act('place');}});
addEventListener('mousemove',e=>{if(document.pointerLockElement===canvas) look(e.movementX,e.movementY);});
function look(dx,dy){player.yaw-=dx*.004;player.pitch=Math.max(-1.43,Math.min(1.43,player.pitch-dy*.004));}

let joyId=null, lookId=null, joyCenter=null, lastTouch=null;
const joy=document.querySelector('#joystick-zone'), knob=document.querySelector('#joystick-knob'), lookZone=document.querySelector('#look-zone');
joy.addEventListener('pointerdown',e=>{joyId=e.pointerId;joy.setPointerCapture(e.pointerId);const r=joy.getBoundingClientRect();joyCenter={x:r.left+r.width/2,y:r.top+r.height/2};});
joy.addEventListener('pointermove',e=>{if(e.pointerId!==joyId)return;const dx=e.clientX-joyCenter.x,dz=e.clientY-joyCenter.y, len=Math.min(42,Math.hypot(dx,dz))||1;move.x=dx/Math.max(42,Math.hypot(dx,dz));move.z=dz/Math.max(42,Math.hypot(dx,dz));knob.style.transform=`translate(${dx/Math.hypot(dx,dz)*len}px,${dz/Math.hypot(dx,dz)*len}px)`;});
function endJoy(e){if(e.pointerId===joyId){joyId=null;move.x=move.z=0;knob.style.transform='';}} joy.addEventListener('pointerup',endJoy);joy.addEventListener('pointercancel',endJoy);
lookZone.addEventListener('pointerdown',e=>{lookId=e.pointerId;lastTouch={x:e.clientX,y:e.clientY};lookZone.setPointerCapture(e.pointerId)});lookZone.addEventListener('pointermove',e=>{if(e.pointerId!==lookId)return;look(e.clientX-lastTouch.x,e.clientY-lastTouch.y);lastTouch={x:e.clientX,y:e.clientY}});lookZone.addEventListener('pointerup',e=>{if(e.pointerId===lookId)lookId=null});
document.querySelector('#jump-btn').onclick=()=>{if(player.onGround)player.vy=7.2};document.querySelector('#break-btn').onclick=()=>act('break');document.querySelector('#place-btn').onclick=()=>act('place');
document.querySelector('#menu-btn').onclick=()=>{playing=false;menu.classList.remove('hidden');};document.querySelector('#resume-btn').onclick=()=>{menu.classList.add('hidden');playing=true};document.querySelector('#save-btn').onclick=()=>{save();document.querySelector('#save-btn').textContent='已保存 ✓';setTimeout(()=>document.querySelector('#save-btn').textContent='立即保存',1200)};
document.querySelector('#reset-btn').onclick=()=>{if(confirm('确定重置整个世界？当前建造将丢失。')){localStorage.removeItem(STORE);generate();rebuild();player.x=0;player.z=8;menu.classList.add('hidden');playing=true;}};
function startGame(){start.classList.add('hidden');hud.classList.remove('hidden');playing=true;}
playBtn.onclick=()=>{generate();rebuild();startGame();};continueBtn.onclick=()=>{if(!load())generate();rebuild();startGame();};
if(localStorage.getItem(STORE))continueBtn.classList.remove('hidden');

let previous=performance.now(), time=0;
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.04,(now-previous)/1000);previous=now;if(playing){
 time+=dt; const dx=(held.KeyD?1:0)-(held.KeyA?1:0)+move.x, dz=(held.KeyW?1:0)-(held.KeyS?1:0)-move.z; movePlayer(dx,dz,dt);
 if((held.Space||held.Numpad0)&&player.onGround)player.vy=7.2;
 player.vy-=18*dt; let ny=player.y+player.vy*dt; if(collides(player.x,ny,player.z)){if(player.vy<0){player.y=Math.floor(player.y)+.001; while(!collides(player.x,player.y-.08,player.z))player.y-=.05;player.vy=0;player.onGround=true;}else player.vy=0;} else {player.y=ny;player.onGround=false;}
 if(player.y<-8){player.x=0;player.z=8;player.y=10;player.vy=0;}
 const cycle=(Math.sin(time*.045)+1)/2; scene.background.setHSL(.56,.55,.28+.38*cycle);scene.fog.color.copy(scene.background);hemi.intensity=.45+1.7*cycle;sun.intensity=.2+2.1*cycle;sun.position.set(Math.cos(time*.045)*25,8+Math.sin(time*.045)*22,10);
 updateCamera();selectTarget();coordsEl.textContent=`X ${player.x.toFixed(1)} · Y ${player.y.toFixed(1)} · Z ${player.z.toFixed(1)}`;statusEl.textContent=`${cycle>.32?'☀ 白天':'☾ 夜晚'} · 世界已自动保存`;
 }
 renderer.render(scene,camera);
}
updateCamera();makeHotbar();loading.classList.add('hidden');requestAnimationFrame(frame);
