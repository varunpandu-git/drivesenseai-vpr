import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const $ = (id) => document.getElementById(id);
const els = {
  video: $('cameraVideo'), canvas: $('overlayCanvas'), stage: $('cameraStage'), placeholder: $('cameraPlaceholder'),
  start: $('startBtn'), stop: $('stopBtn'), help: $('cameraHelp'), toast: $('toast'),
  statusMetric: $('statusMetric'), statusPill: $('statusPill'), attentionMetric: $('attentionMetric'), attentionBar: $('attentionBar'), attentionHint: $('attentionHint'),
  eventMetric: $('eventMetric'), durationMetric: $('durationMetric'), sessionHint: $('sessionHint'), feedTag: $('feedTag'),
  engineState: $('engineState'), stateBanner: $('stateBanner'), stateIcon: $('stateIcon'), stateTitle: $('stateTitle'), stateDescription: $('stateDescription'),
  eyeDetail: $('eyeDetail'), eyeValue: $('eyeValue'), headValue: $('headValue'), mouthDetail: $('mouthDetail'), mouthValue: $('mouthValue'), attentionValue: $('attentionValue'),
  hudFeedStatus: $('hudFeedStatus'), faceIndicator: $('faceIndicator'), fpsIndicator: $('fpsIndicator'), landmarkIndicator: $('landmarkIndicator'), recordingIndicator: $('recordingIndicator'),
  eventTable: $('eventTable'), eventCountLabel: $('eventCountLabel'), exportBtn: $('exportBtn'), clearBtn: $('clearBtn'),
  qualityStatus: $('qualityStatus'), faceQualityText: $('faceQualityText'), faceQualityBar: $('faceQualityBar'), eyeQualityText: $('eyeQualityText'), eyeQualityBar: $('eyeQualityBar'), headQualityText: $('headQualityText'), headQualityBar: $('headQualityBar')
};
const ctx = els.canvas.getContext('2d');
let landmarker = null, stream = null, running = false, rafId = null, startedAt = 0, lastVideoTime = -1, lastFrameAt = 0, fps = 0;
let eyeClosedSince = 0, lookingAwaySince = 0, yawnSince = 0, lastAlertAt = 0, lastState = 'Standby', lastEventAt = 0;
let eventLog = [], sessionId = '', toastTimer = null, audioContext = null;
let lastFace = false, lastMetrics = {eyeOpen: null, head: '—', mouth: null, attention: null};

function updateClock(){const now=new Date();$('clock').textContent=now.toLocaleTimeString([], {hour12:false});$('dateLabel').textContent=now.toLocaleDateString([], {weekday:'short',year:'numeric',month:'short',day:'2-digit'});$('footerYear').textContent=now.getFullYear();}
updateClock();setInterval(updateClock,1000);
function toast(message){els.toast.textContent=message;els.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>els.toast.classList.remove('show'),3400);}
function setBar(el,value){el.style.width=`${Math.max(0,Math.min(100,value||0))}%`;}
function formatDuration(ms){const total=Math.floor(ms/1000);return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;}
function scoreText(v){return v==null?'—':`${Math.round(v*100)}%`;}
function setState(state,description,level='safe'){
  els.statusMetric.textContent=state;els.stateTitle.textContent=state;els.stateDescription.textContent=description;
  els.stateBanner.classList.toggle('warning',level==='warn');els.stateBanner.classList.toggle('danger',level==='danger');
  els.stateIcon.textContent=level==='danger'?'!':level==='warn'?'△':'◎';
  els.statusPill.className=`status-pill ${level==='danger'?'danger':level==='warn'?'warn':level==='safe'?'safe':'neutral'}`;
  els.statusPill.textContent=level==='danger'?'● High risk':level==='warn'?'● Attention needed':level==='safe'?'● Monitoring':'● Waiting';
  if(state!==lastState && running){
    const now=Date.now();
    if(state!=='Alert' && state!=='Standby' && now-lastEventAt>1800){addEvent(state,description,level==='danger'?'High':level==='warn'?'Warning':'Info');lastEventAt=now;}
    lastState=state;
  }
}
function addEvent(name,detail,level='Warning'){
  const event={name,detail,time:new Date(),level};eventLog.unshift(event);if(eventLog.length>100)eventLog.pop();
  renderEvents();els.eventMetric.textContent=eventLog.length;
}
function renderEvents(){
  els.eventCountLabel.textContent=`Showing ${eventLog.length} event${eventLog.length===1?'':'s'}`;
  if(!eventLog.length){els.eventTable.innerHTML='<tr class="empty-row"><td colspan="4"><span class="empty-icon">≋</span><b>No events recorded yet</b><small>Start monitoring to populate this activity log.</small></td></tr>';return;}
  els.eventTable.innerHTML=eventLog.slice(0,12).map(e=>{const levelClass=e.level==='High'?'high':e.level==='Info'?'info':'warning';const bulletClass=e.level==='High'?'danger':e.level==='Info'?'info':'';return `<tr><td><span class="event-name"><i class="event-bullet ${bulletClass}"></i>${escapeHtml(e.name)}</span></td><td>${e.time.toLocaleTimeString([], {hour12:false})}</td><td>${escapeHtml(e.detail)}</td><td><span class="level ${levelClass}">${e.level.toUpperCase()}</span></td></tr>`}).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function getBlendshape(categories,name){return categories?.find(c=>c.categoryName===name)?.score ?? 0;}
function updateSignalUI({hasFace,eyeOpen,head,mouthOpen,attention}){
  els.faceQualityText.textContent=hasFace?'Detected':'Not detected';setBar(els.faceQualityBar,hasFace?100:0);
  els.eyeQualityText.textContent=eyeOpen==null?'—':eyeOpen?'Open':'Closed';setBar(els.eyeQualityBar,eyeOpen==null?0:eyeOpen?92:12);
  els.headQualityText.textContent=head==='Center'?'Aligned':head;setBar(els.headQualityBar,head==='Center'?92:head==='—'?0:42);
  els.qualityStatus.textContent=!running?'IDLE':hasFace?'TRACKING':'SEARCHING';
  els.qualityStatus.style.color=hasFace?'var(--green)':'var(--amber)';
  els.eyeDetail.textContent=eyeOpen==null?'No face detected':eyeOpen?'Eyes appear open':'Possible eye closure';
  els.eyeValue.textContent=eyeOpen==null?'—':eyeOpen?'OPEN':'CLOSED';els.eyeValue.className='value-chip '+(eyeOpen==null?'':eyeOpen?'good':'warn');
  els.headValue.textContent=head;els.headValue.className='value-chip '+(head==='Center'?'good':head==='—'?'':'warn');
  els.mouthDetail.textContent=mouthOpen==null?'Waiting for landmarks':mouthOpen?'Mouth opening elevated':'No strong yawn signal';
  els.mouthValue.textContent=mouthOpen==null?'—':mouthOpen?'OPEN':'NORMAL';els.mouthValue.className='value-chip '+(mouthOpen?'warn':'good');
  els.attentionValue.textContent=attention==null?'—':scoreText(attention);els.attentionValue.className='value-chip '+(attention==null?'':attention>=.75?'good':attention>=.45?'warn':'bad');
  els.attentionMetric.textContent=attention==null?'—':Math.round(attention*100);setBar(els.attentionBar,(attention||0)*100);
  els.attentionHint.textContent=attention==null?'Awaiting camera':attention>=.75?'Attention looks steady':attention>=.45?'Monitor attention closely':'Low attention indicator';
  els.faceIndicator.textContent=`FACE: ${hasFace?'TRACKED':'NOT FOUND'}`;els.landmarkIndicator.textContent=`LANDMARKS: ${hasFace?'ACTIVE':'SEARCHING'}`;
}
function beep(){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=880;gain.gain.setValueAtTime(.0001,audioContext.currentTime);gain.gain.exponentialRampToValueAtTime(.12,audioContext.currentTime+.02);gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+.24);osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+.25);}catch(_){}}
function triggerAlert(){if(Date.now()-lastAlertAt>3500){lastAlertAt=Date.now();beep();}}
function estimateHead(landmarks){
  const nose=landmarks[1], left=landmarks[234], right=landmarks[454], forehead=landmarks[10], chin=landmarks[152];
  const centerX=(left.x+right.x)/2, width=Math.max(.001,Math.abs(right.x-left.x));
  const horizontal=(nose.x-centerX)/width;
  const vertical=(nose.y-(forehead.y+(chin.y-forehead.y)*.48));
  if(horizontal<-.12)return 'Left';if(horizontal>.12)return 'Right';
  if(vertical>.055)return 'Down';if(vertical<-.065)return 'Up';return 'Center';
}
function drawOverlay(landmarks){
  const w=els.stage.clientWidth,h=els.stage.clientHeight;ctx.clearRect(0,0,w,h);if(!landmarks)return;
  const points=[33,133,159,145,362,263,386,374,1,10,152,13,14,234,454];
  ctx.fillStyle='#45f0cb';for(const i of points){const p=landmarks[i];if(!p)continue;ctx.beginPath();ctx.arc(p.x*w,p.y*h,2.2,0,Math.PI*2);ctx.fill();}
  ctx.strokeStyle='rgba(66,229,197,.75)';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(landmarks[33].x*w,landmarks[33].y*h);ctx.lineTo(landmarks[133].x*w,landmarks[133].y*h);ctx.moveTo(landmarks[362].x*w,landmarks[362].y*h);ctx.lineTo(landmarks[263].x*w,landmarks[263].y*h);ctx.stroke();
  const xs=landmarks.map(p=>p.x*w),ys=landmarks.map(p=>p.y*h);const x=Math.max(0,Math.min(...xs)-18),y=Math.max(0,Math.min(...ys)-18),rw=Math.min(w-x,Math.max(...xs)-Math.min(...xs)+36),rh=Math.min(h-y,Math.max(...ys)-Math.min(...ys)+36);
  ctx.strokeStyle='#45f0cb';ctx.lineWidth=1.5;const c=13;ctx.beginPath();ctx.moveTo(x,y+c);ctx.lineTo(x,y);ctx.lineTo(x+c,y);ctx.moveTo(x+rw-c,y);ctx.lineTo(x+rw,y);ctx.lineTo(x+rw,y+c);ctx.moveTo(x+rw,y+rh-c);ctx.lineTo(x+rw,y+rh);ctx.lineTo(x+rw-c,y+rh);ctx.moveTo(x+c,y+rh);ctx.lineTo(x,y+rh);ctx.lineTo(x,y+rh-c);ctx.stroke();
}
function processResult(result,now){
  const landmarks=result.faceLandmarks?.[0],categories=result.faceBlendshapes?.[0]?.categories;const hasFace=!!landmarks;
  if(!hasFace){drawOverlay(null);updateSignalUI({hasFace:false,eyeOpen:null,head:'—',mouthOpen:null,attention:null});els.fpsIndicator.textContent=`FPS: ${fps?Math.round(fps):'—'}`;setState('Face not detected','Move into the camera frame and improve lighting.','neutral');return;}
  drawOverlay(landmarks);
  const blinkLeft=getBlendshape(categories,'eyeBlinkLeft'),blinkRight=getBlendshape(categories,'eyeBlinkRight');const eyeOpen=(blinkLeft+blinkRight)/2<.48;
  const jawOpen=getBlendshape(categories,'jawOpen');const mouthOpen=jawOpen>.58;const head=estimateHead(landmarks);const eyesClosed=!eyeOpen;
  if(eyesClosed){if(!eyeClosedSince)eyeClosedSince=now;}else eyeClosedSince=0;
  if(head!=='Center'){if(!lookingAwaySince)lookingAwaySince=now;}else lookingAwaySince=0;
  if(mouthOpen){if(!yawnSince)yawnSince=now;}else yawnSince=0;
  const eyeDuration=eyeClosedSince?now-eyeClosedSince:0,lookDuration=lookingAwaySince?now-lookingAwaySince:0,yawnDuration=yawnSince?now-yawnSince:0;
  let attention=1;
  if(!eyeOpen)attention-=.42;if(head!=='Center')attention-=.35;if(mouthOpen)attention-=.1;
  if(eyeDuration>900)attention-=.2;if(lookDuration>850)attention-=.15;attention=Math.max(0,Math.min(1,attention));
  lastMetrics={eyeOpen,head,mouth:mouthOpen,attention};updateSignalUI({hasFace:true,eyeOpen,head,mouthOpen,attention});
  let state='Alert',description='Face is visible and no sustained warning signal is detected.',level='safe';
  if(eyeDuration>2200){state='Sleeping';description='Eyes appear closed for an extended period.';level='danger';}
  else if(eyeDuration>950){state='Drowsy';description='Possible prolonged eye closure detected.';level='danger';}
  else if(lookDuration>1100){state='Distracted';description=`Head direction is ${head.toLowerCase()} for a sustained period.`;level='warn';}
  else if(yawnDuration>1400){state='Possible fatigue';description='Sustained mouth opening may indicate a yawn.';level='warn';}
  else if(!eyeOpen||head!=='Center'){state='Attention shift';description='Brief eye or head movement detected; observe the driver context.';level='warn';}
  setState(state,description,level);if(level==='danger')triggerAlert();
  els.fpsIndicator.textContent=`FPS: ${fps?Math.round(fps):'—'}`;
}
async function loadLandmarker(){
  if(landmarker)return landmarker;
  els.engineState.textContent='LOADING';els.help.textContent='Loading the browser vision model. The first load needs an internet connection.';
  const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',delegate:'GPU'},runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:false});
  els.engineState.textContent='ONLINE';return landmarker;
}
async function startMonitoring(){
  if(running)return;
  if(!navigator.mediaDevices?.getUserMedia){toast('Camera access is unavailable. Open the website on HTTPS or localhost.');return;}
  els.start.disabled=true;els.start.innerHTML='<span>◌</span> Starting…';
  try{
    await loadLandmarker();
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:false});
    els.video.srcObject=stream;await els.video.play();
    const dpr=window.devicePixelRatio||1;els.canvas.width=Math.round(els.stage.clientWidth*dpr);els.canvas.height=Math.round(els.stage.clientHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    running=true;startedAt=Date.now();sessionId=`DS-${startedAt.toString(36).toUpperCase()}`;lastState='Standby';eyeClosedSince=lookingAwaySince=yawnSince=0;lastEventAt=0;
    els.stage.classList.add('running');els.feedTag.classList.add('active');els.feedTag.innerHTML='<span></span> CAMERA LIVE';els.hudFeedStatus.textContent='LIVE SIGNAL';els.recordingIndicator.textContent=`SESSION ${sessionId}`;
    els.start.disabled=true;els.start.innerHTML='● Monitoring';els.stop.disabled=false;els.sessionHint.textContent='Session active';els.help.textContent='Monitoring is active. Keep your face visible and centered for better landmark tracking.';
    els.qualityStatus.textContent='TRACKING';els.engineState.textContent='ONLINE';toast('Camera started. Browser-based analysis is active.');loop();
  }catch(err){console.error(err);els.start.disabled=false;els.start.innerHTML='<span>▶</span> Start monitoring';els.engineState.textContent=landmarker?'READY':'ERROR';els.help.textContent=err?.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings and try again.':`Could not start monitoring: ${err?.message||'camera or model unavailable'}. Use HTTPS and allow camera access.`;toast('Could not start. Check camera permission and internet connection.');if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
}
function loop(){if(!running)return;const now=performance.now();if(els.video.readyState>=2&&els.video.currentTime!==lastVideoTime){if(lastFrameAt){const delta=now-lastFrameAt;const instant=1000/Math.max(1,delta);fps=fps?fps*.82+instant*.18:instant;}lastFrameAt=now;lastVideoTime=els.video.currentTime;try{const result=landmarker.detectForVideo(els.video,now);processResult(result,Date.now());}catch(err){console.error('Detection error',err);}}els.durationMetric.textContent=formatDuration(Date.now()-startedAt);rafId=requestAnimationFrame(loop);}
function stopMonitoring(){running=false;if(rafId)cancelAnimationFrame(rafId);if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}els.video.srcObject=null;ctx.clearRect(0,0,els.stage.clientWidth,els.stage.clientHeight);els.stage.classList.remove('running');els.feedTag.classList.remove('active');els.feedTag.innerHTML='<span></span> CAMERA OFF';els.hudFeedStatus.textContent='NO SIGNAL';els.recordingIndicator.textContent='SESSION IDLE';els.start.disabled=false;els.start.innerHTML='<span>▶</span> Start monitoring';els.stop.disabled=true;els.sessionHint.textContent='Session ended';els.engineState.textContent=landmarker?'READY':'READY';els.help.textContent='Session stopped. Event history remains available until you clear or reload the page.';setState('Standby','Start monitoring to analyze visible face landmarks.','neutral');updateSignalUI({hasFace:false,eyeOpen:null,head:'—',mouthOpen:null,attention:null});toast('Monitoring stopped.');}
function exportCsv(){if(!eventLog.length){toast('There are no safety events to export yet.');return;}const rows=[['event','time','detail','level'],...eventLog.slice().reverse().map(e=>[e.name,e.time.toISOString(),e.detail,e.level])];const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`driver-events-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);toast('Event log exported as CSV.');}
els.start.addEventListener('click',startMonitoring);els.stop.addEventListener('click',stopMonitoring);els.exportBtn.addEventListener('click',exportCsv);els.clearBtn.addEventListener('click',()=>{eventLog=[];renderEvents();els.eventMetric.textContent='0';toast('Session event log cleared.');});
window.addEventListener('resize',()=>{if(running){const dpr=window.devicePixelRatio||1;els.canvas.width=Math.round(els.stage.clientWidth*dpr);els.canvas.height=Math.round(els.stage.clientHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}});
window.addEventListener('beforeunload',()=>{if(stream)stream.getTracks().forEach(t=>t.stop());});